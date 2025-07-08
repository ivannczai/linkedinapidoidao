const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const geminiService = require('../services/gemini.service');
const PDFDocument = require('pdfkit');

const router = express.Router();

// --- Rotas de Clientes ---

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// @route   POST api/clients
// @desc    Admin cria um novo usuário cliente
router.post('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Email e name são obrigatórios.' });

  try {
    // Gerar senha aleatória
    const password = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const query = `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'client', $3) RETURNING id, email, name, role;`;
    const { rows } = await pool.query(query, [email, name, passwordHash]);
    
    // Retorna o novo cliente junto com a senha gerada (apenas neste momento)
    res.status(201).json({ ...rows[0], plain_password: password });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ error: 'Falha ao criar cliente.' });
  }
});

// @route   GET api/clients
// @desc    Admin lista todos os usuários clientes
router.get('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  try {
    const query = `
      SELECT u.id, u.email, u.name, u.created_at, la.linkedin_id 
      FROM users u
      LEFT JOIN linkedin_accounts la ON u.id = la.user_id
      WHERE u.role = 'client'
      ORDER BY u.created_at DESC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao listar clientes.' });
  }
});

// @route   GET api/clients/:id
// @desc    Obter detalhes de um cliente específico, incluindo a conta do LinkedIn
router.get('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  try {
    const query = `
      SELECT u.id, u.email, u.name, u.created_at, la.linkedin_id, la.token_expires_at 
      FROM users u
      LEFT JOIN linkedin_accounts la ON u.id = la.user_id
      WHERE u.role = 'client' AND u.id = $1;
    `;
    const { rows } = await pool.query(query, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Client not found' });
    }
    // Renomeia linkedin_id para linkedin_account para clareza no frontend
    const clientData = {
      ...rows[0],
      linkedin_account: rows[0].linkedin_id ? {
        linkedin_id: rows[0].linkedin_id,
        token_expires_at: rows[0].token_expires_at
      } : null
    };
    delete clientData.linkedin_id;
    delete clientData.token_expires_at;

    res.json(clientData);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/clients/:id
// @desc    Admin atualiza os dados de um cliente
router.put('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nome e email são obrigatórios.' });

  try {
    const query = `UPDATE users SET name = $1, email = $2 WHERE id = $3 AND role = 'client' RETURNING id, name, email;`;
    const { rows } = await pool.query(query, [name, email, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ msg: 'Cliente não encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Falha ao atualizar cliente.' });
  }
});

// @route   DELETE api/clients/:id
// @desc    Admin deleta um cliente
router.delete('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  try {
    // A exclusão em cascata no banco de dados cuidará de posts, etc.
    const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'client'", [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ msg: 'Cliente não encontrado.' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Falha ao deletar cliente.' });
  }
});

// --- Rotas de Posts (Aninhadas sob Clientes) ---

// @route   POST api/clients/:clientId/posts
// @desc    Admin agenda um post para um cliente com tags
router.post('/:clientId/posts', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

    const { clientId } = req.params;
    const { contentText, scheduledAt, tagIds } = req.body; // Adicionado tagIds
    if (!contentText || !scheduledAt) return res.status(400).json({ error: 'Conteúdo e data de agendamento são obrigatórios.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const postQuery = `INSERT INTO posts (user_id, content_text, scheduled_at) VALUES ($1, $2, $3) RETURNING *;`;
        const { rows: postRows } = await client.query(postQuery, [clientId, contentText, scheduledAt]);
        const newPost = postRows[0];

        if (tagIds && tagIds.length > 0) {
            const tagQuery = 'INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)';
            for (const tagId of tagIds) {
                await client.query(tagQuery, [newPost.id, tagId]);
            }
        }

        await client.query('COMMIT');
        res.status(201).json(newPost);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error scheduling post with tags:', error);
        res.status(500).json({ error: 'Falha ao agendar post.' });
    } finally {
        client.release();
    }
});

// @route   GET api/clients/:clientId/posts
// @desc    Admin lista os posts de um cliente, incluindo suas tags
router.get('/:clientId/posts', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });
    
    const { clientId } = req.params;
    try {
        const query = `
            SELECT 
                p.*, 
                COALESCE(
                    (SELECT json_agg(t.id) FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = p.id), 
                    '[]'::json
                ) as tags
            FROM posts p
            WHERE p.user_id = $1 
            ORDER BY p.scheduled_at DESC;
        `;
        const { rows } = await pool.query(query, [clientId]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching posts with tags:', error);
        res.status(500).json({ error: 'Falha ao listar posts.' });
    }
});

// @route   PUT api/clients/:clientId/posts/:postId
// @desc    Admin atualiza um post agendado com tags
router.put('/:clientId/posts/:postId', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

    const { postId } = req.params;
    const { contentText, scheduledAt, tagIds } = req.body; // Adicionado tagIds
    if (!contentText || !scheduledAt) return res.status(400).json({ error: 'Conteúdo e data são obrigatórios.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const postQuery = `UPDATE posts SET content_text = $1, scheduled_at = $2 WHERE id = $3 AND status = 'SCHEDULED' RETURNING *;`;
        const { rows: postRows } = await client.query(postQuery, [contentText, scheduledAt, postId]);
        if (postRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Post não encontrado ou já publicado.' });
        }
        const updatedPost = postRows[0];

        // Limpa as tags antigas e insere as novas
        await client.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
        if (tagIds && tagIds.length > 0) {
            const tagQuery = 'INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)';
            for (const tagId of tagIds) {
                await client.query(tagQuery, [updatedPost.id, tagId]);
            }
        }

        await client.query('COMMIT');
        res.json(updatedPost);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating post with tags:', error);
        res.status(500).json({ error: 'Falha ao atualizar post.' });
    } finally {
        client.release();
    }
});

// @route   DELETE api/clients/:clientId/posts/:postId
// @desc    Admin deleta um post agendado
router.delete('/:clientId/posts/:postId', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });
    
    const { postId } = req.params;
    try {
        const query = `DELETE FROM posts WHERE id = $1 AND status = 'SCHEDULED' RETURNING *;`;
        const { rows } = await pool.query(query, [postId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Post não encontrado ou já publicado.' });
        res.status(200).json({ message: 'Post deletado com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao deletar post.' });
    }
});

// @route   GET api/clients/:clientId/posts/:postId/analytics
// @desc    Admin busca as métricas de um post específico
router.get('/:clientId/posts/:postId/analytics', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

    const { postId } = req.params;
    try {
        const query = 'SELECT * FROM post_analytics WHERE post_id = $1 ORDER BY timestamp ASC';
        const { rows } = await pool.query(query, [postId]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Falha ao buscar analytics do post.' });
    }
});

// @route   POST api/clients/:clientId/ai-analysis
// @desc    Admin solicita uma análise de IA para os posts de um cliente
router.post('/:clientId/ai-analysis', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

    const { clientId } = req.params;
    const { dateRange } = req.body; // Ex: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }

    try {
        // Coleta de dados para a análise
        const query = `
            SELECT 
                p.content_text,
                p.published_at,
                (SELECT json_agg(json_build_object('name', t.name, 'category', t.category)) 
                 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = p.id) as tags,
                (SELECT json_agg(json_build_object('impressions', pa.impressions, 'reactions', pa.reactions, 'comments', pa.comments)) 
                 FROM post_analytics pa WHERE pa.post_id = p.id) as analytics
            FROM posts p
            WHERE p.user_id = $1 
              AND p.status = 'PUBLISHED'
              AND p.published_at BETWEEN $2 AND $3
            ORDER BY p.published_at DESC;
        `;
        const { rows: postData } = await pool.query(query, [clientId, dateRange.start, dateRange.end]);

        if (postData.length === 0) {
            return res.status(404).json({ error: 'No published posts found in the selected date range.' });
        }

        const analysis = await geminiService.generateAnalysis(postData);
        res.json({ analysis });

    } catch (error) {
        console.error('Error generating AI analysis:', error);
        res.status(500).json({ error: 'Failed to generate AI analysis.' });
    }
});

// @route   GET api/clients/:clientId/reports/performance
// @desc    Admin gera um relatório de performance em PDF
router.get('/:clientId/reports/performance', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

    const { clientId } = req.params;
    const { startDate, endDate } = req.query; // Ex: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

    try {
        // 1. Fetch Client Info
        const { rows: clientRows } = await pool.query('SELECT name FROM users WHERE id = $1', [clientId]);
        if (clientRows.length === 0) return res.status(404).json({ error: 'Client not found.' });
        const clientName = clientRows[0].name;

        // 2. Fetch Data for AI Analysis
        const query = `
            SELECT 
                p.content_text, p.published_at,
                (SELECT json_agg(json_build_object('name', t.name, 'category', t.category)) FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = p.id) as tags,
                (SELECT json_agg(json_build_object('impressions', pa.impressions, 'reactions', pa.reactions, 'comments', pa.comments)) FROM post_analytics pa WHERE pa.post_id = p.id) as analytics
            FROM posts p
            WHERE p.user_id = $1 AND p.status = 'PUBLISHED' AND p.published_at BETWEEN $2 AND $3
            ORDER BY p.published_at DESC;
        `;
        const { rows: postData } = await pool.query(query, [clientId, startDate, endDate]);
        if (postData.length === 0) return res.status(404).json({ error: 'No published posts found in the selected date range.' });

        // 3. Generate AI Summary
        const executiveSummary = await geminiService.generateAnalysis(postData);

        // 4. Generate PDF
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=performance_report_${clientName.replace(/\s/g, '_')}_${startDate}_${endDate}.pdf`);
        doc.pipe(res);

        // --- PDF Content ---
        // Header
        doc.fontSize(20).text(`Performance Report: ${clientName}`, { align: 'center' });
        doc.fontSize(12).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown(2);

        // Executive Summary
        doc.fontSize(16).text('AI-Powered Executive Summary', { underline: true });
        doc.moveDown();
        doc.fontSize(10).text(executiveSummary);
        doc.moveDown(2);

        // Top Performing Posts (simple list for now)
        doc.fontSize(16).text('Content Highlights', { underline: true });
        doc.moveDown();
        postData.slice(0, 3).forEach(post => {
            doc.fontSize(12).text(`Post from ${moment(post.published_at).format('YYYY-MM-DD')}:`, { continued: true, underline: true });
            const analytics = post.analytics ? post.analytics[0] : { impressions: 0, reactions: 0, comments: 0 };
            doc.text(` ${analytics.impressions || 0} impressions, ${analytics.reactions || 0} reactions, ${analytics.comments || 0} comments.`);
            doc.fontSize(10).text(post.content_text.substring(0, 200) + '...');
            doc.moveDown();
        });
        
        // --- Finalize PDF ---
        doc.end();

    } catch (error) {
        console.error('Error generating PDF report:', error);
        res.status(500).send('Failed to generate PDF report.');
    }
});

module.exports = router;
