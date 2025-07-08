const cron = require('node-cron');
const db = require('./config/db');
const linkedinService = require('./services/linkedin.service');

// Job que roda a cada minuto para verificar e publicar posts agendados
const publishScheduledPosts = cron.schedule('* * * * *', async () => {
  console.log(`[Scheduler Tick @ ${new Date().toLocaleTimeString()}] Checking for posts to publish...`);
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Seleciona e bloqueia as linhas para evitar que outros workers as peguem
    const { rows: postsToPublish } = await client.query("SELECT * FROM posts WHERE status = 'SCHEDULED' AND scheduled_at <= NOW() FOR UPDATE SKIP LOCKED");
    if (postsToPublish.length === 0) {
      await client.query('COMMIT');
      return;
    }

    // Marca os posts como 'PUBLISHING' para que não sejam pegos novamente
    const postIds = postsToPublish.map(p => p.id);
    await client.query("UPDATE posts SET status = 'PUBLISHING' WHERE id = ANY($1::int[])", [postIds]);
    
    await client.query('COMMIT');

    for (const post of postsToPublish) {
      try {
        const { rows: accountRows } = await db.query('SELECT linkedin_id, access_token FROM linkedin_accounts WHERE user_id = $1', [post.user_id]);
        const account = accountRows[0];

        if (!account || !account.linkedin_id || !account.access_token) {
          throw new Error(`Token ou LinkedIn ID não encontrado para o usuário ${post.user_id}`);
        }

        // O 'linkedin_id' agora é o URN completo, não precisa de prefixo.
        const postUrn = await linkedinService.publishPost(account.access_token, account.linkedin_id, post.content_text);
        console.log('--- URN RECEBIDO APÓS POSTAGEM ---');
        console.log(postUrn);

        const updateQuery = `UPDATE posts SET status = 'PUBLISHED', published_at = NOW(), linkedin_post_urn = $1 WHERE id = $2;`;
        await db.query(updateQuery, [postUrn, post.id]);
        console.log(`Post ${post.id} publicado com sucesso! URN: ${postUrn}`);

      } catch (publishError) {
        const errorData = publishError.response?.data;
        console.error(`Erro detalhado ao publicar o post ${post.id}:`, JSON.stringify(errorData, null, 2));

        const isDuplicate = errorData?.errorDetails?.inputErrors?.some(e => e.code === 'DUPLICATE_POST');

        if (isDuplicate) {
          const duplicateUrnMatch = errorData.message.match(/(urn:li:share:\d+)/);
          const duplicateUrn = duplicateUrnMatch ? duplicateUrnMatch[1] : null;
          
          const updateQuery = `UPDATE posts SET status = 'PUBLISHED', linkedin_post_urn = $1, published_at = NOW() WHERE id = $2;`;
          await db.query(updateQuery, [duplicateUrn, post.id]);
          console.log(`Post ${post.id} já existia. Status atualizado para PUBLISHED.`);
        } else {
          const updateQuery = `UPDATE posts SET status = 'FAILED' WHERE id = $1;`;
          await db.query(updateQuery, [post.id]);
        }
      }
    }
  } catch (dbError) {
    console.error('Erro no job de publicação:', dbError);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

// Job que roda a cada minuto para buscar métricas de posts publicados
const fetchPostAnalytics = cron.schedule('* * * * *', async () => {
  console.log(`[Scheduler Tick @ ${new Date().toLocaleTimeString()}] Checking for analytics to fetch...`);
  try {
    // Busca posts publicados que não foram atualizados na última hora
    const query = `
      SELECT * FROM posts 
      WHERE status = 'PUBLISHED' 
      AND linkedin_post_urn IS NOT NULL
      AND (analytics_last_updated_at IS NULL OR analytics_last_updated_at < NOW() - INTERVAL '1 hour')
    `;
    const { rows: postsToUpdate } = await db.query(query);
    if (postsToUpdate.length === 0) return;

    console.log(`Buscando métricas para ${postsToUpdate.length} post(s)...`);

    for (const post of postsToUpdate) {
      try {
        const { rows: accountRows } = await db.query('SELECT access_token FROM linkedin_accounts WHERE user_id = $1', [post.user_id]);
        const account = accountRows[0];

        if (!account || !account.access_token) {
          throw new Error(`Token não encontrado para o usuário ${post.user_id}`);
        }

        const analytics = await linkedinService.getPostAnalytics(account.access_token, post.linkedin_post_urn);
        
        // Deleta métricas antigas para inserir as novas (evita duplicatas)
        await db.query('DELETE FROM post_analytics WHERE post_id = $1', [post.id]);
        
        const insertQuery = `INSERT INTO post_analytics (post_id, impressions, reactions, comments) VALUES ($1, $2, $3, $4);`;
        await db.query(insertQuery, [post.id, analytics.impressions, analytics.reactions, analytics.comments]);

        // Atualiza o timestamp do post
        await db.query('UPDATE posts SET analytics_last_updated_at = NOW() WHERE id = $1', [post.id]);

        console.log(`Métricas salvas e atualizadas para o post ${post.id}.`);

      } catch (analyticsError) {
        // Se o erro for 404 (Not Found), o post foi deletado no LinkedIn
        if (analyticsError.response && analyticsError.response.status === 404) {
          await db.query("UPDATE posts SET status = 'DELETED' WHERE id = $1", [post.id]);
          console.warn(`Post ${post.id} não encontrado no LinkedIn. Marcado como DELETED.`);
        } else {
          console.error(`Erro ao buscar métricas para o post ${post.id}:`, analyticsError.message);
        }
      }
    }
  } catch (dbError) {
    console.error('Erro no job de busca de métricas:', dbError);
  }
});

// Job que roda uma vez por dia para renovar os refresh tokens
const refreshAccessTokens = cron.schedule('0 3 * * *', async () => { // Roda todo dia às 3 da manhã
  console.log(`[Scheduler Tick @ ${new Date().toLocaleTimeString()}] Checking for tokens to refresh...`);
  try {
    // Seleciona contas cujo token de acesso expira nos próximos 7 dias
    const { rows: accountsToRefresh } = await db.query("SELECT * FROM linkedin_accounts WHERE token_expires_at < NOW() + INTERVAL '7 days'");
    if (accountsToRefresh.length === 0) return;

    console.log(`Refreshing tokens for ${accountsToRefresh.length} account(s)...`);

    for (const account of accountsToRefresh) {
      try {
        const tokenData = await linkedinService.refreshAccessToken(account.refresh_token);
        
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

        const query = `
          UPDATE linkedin_accounts 
          SET access_token = $1, refresh_token = $2, token_expires_at = $3
          WHERE user_id = $4;
        `;
        await db.query(query, [tokenData.access_token, tokenData.refresh_token, expiresAt, account.user_id]);
        console.log(`Token for user ${account.user_id} refreshed successfully.`);

      } catch (refreshError) {
        console.error(`Failed to refresh token for user ${account.user_id}:`, refreshError.message);
        // Opcional: Adicionar lógica para notificar o admin se um refresh token falhar
      }
    }
  } catch (dbError) {
    console.error('Error in token refresh job:', dbError);
  }
});

module.exports = {
  start: () => {
    console.log('Iniciando agendadores...');
    publishScheduledPosts.start();
    fetchPostAnalytics.start();
    refreshAccessTokens.start();
  },
};
