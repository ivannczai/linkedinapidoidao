const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { Parser } = require('json2csv');

const router = express.Router();

// Middleware para garantir que apenas admins possam acessar
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Access denied. Admin role required.' });
  }
  next();
};

router.use(authMiddleware);
router.use(adminOnly);

// GET /api/analytics/summary
// Retorna dados agregados para os painéis e gráficos principais.
router.get('/summary', async (req, res) => {
  const { clientIds, startDate, endDate } = req.query;

  try {
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (startDate) {
      whereClauses.push(`p.scheduled_at >= $${paramIndex++}`);
      queryParams.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`p.scheduled_at <= $${paramIndex++}`);
      queryParams.push(endDate);
    }
    if (clientIds) {
      const ids = clientIds.split(',').map(id => parseInt(id, 10));
      whereClauses.push(`p.user_id = ANY($${paramIndex++})`);
      queryParams.push(ids);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const summaryQuery = `
      SELECT
        COUNT(p.id) AS total_posts,
        SUM(pa.impressions) AS total_impressions,
        SUM(pa.reactions) AS total_reactions,
        SUM(pa.comments) AS total_comments,
        AVG(pa.impressions) AS avg_impressions,
        AVG(pa.reactions) AS avg_reactions,
        AVG(pa.comments) AS avg_comments
      FROM posts p
      LEFT JOIN post_analytics pa ON p.id = pa.post_id
      ${whereSql};
    `;

    const trendQuery = `
      SELECT
        DATE_TRUNC('day', p.scheduled_at) AS date,
        SUM(pa.impressions) AS impressions,
        SUM(pa.reactions) AS reactions,
        SUM(pa.comments) AS comments
      FROM posts p
      LEFT JOIN post_analytics pa ON p.id = pa.post_id
      ${whereSql}
      GROUP BY date
      ORDER BY date;
    `;

    const [summaryResult, trendResult] = await Promise.all([
      pool.query(summaryQuery, queryParams),
      pool.query(trendQuery, queryParams)
    ]);

    res.json({
      summary: summaryResult.rows[0],
      trend: trendResult.rows,
    });

  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ error: 'Failed to fetch analytics summary.' });
  }
});

// GET /api/analytics/raw-data
// Retorna a lista de posts com seus dados brutos para a tabela detalhada.
router.get('/raw-data', async (req, res) => {
  const { clientIds, startDate, endDate, page = 1, limit = 10 } = req.query;

  try {
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (startDate) {
      whereClauses.push(`p.scheduled_at >= $${paramIndex++}`);
      queryParams.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`p.scheduled_at <= $${paramIndex++}`);
      queryParams.push(endDate);
    }
    if (clientIds) {
      const ids = clientIds.split(',').map(id => parseInt(id, 10));
      whereClauses.push(`p.user_id = ANY($${paramIndex++})`);
      queryParams.push(ids);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const rawDataQuery = `
      SELECT
        u.name AS client_name,
        p.scheduled_at AS post_date,
        p.content_text,
        p.linkedin_post_urn,
        p.status,
        COALESCE(pa.impressions, 0) AS impressions,
        COALESCE(pa.reactions, 0) AS reactions,
        COALESCE(pa.comments, 0) AS comments,
        (
          SELECT STRING_AGG(t.name, '; ')
          FROM post_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE pt.post_id = p.id
        ) AS tags
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_analytics pa ON p.id = pa.post_id
      ${whereSql}
      ORDER BY p.scheduled_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    const countQuery = `SELECT COUNT(p.id) FROM posts p ${whereSql};`;

    const [dataResult, countResult] = await Promise.all([
      pool.query(rawDataQuery, [...queryParams, limit, offset]),
      pool.query(countQuery, queryParams)
    ]);

    res.json({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

  } catch (error) {
    console.error('Error fetching raw analytics data:', error);
    res.status(500).json({ error: 'Failed to fetch raw analytics data.' });
  }
});

// GET /api/analytics/export-csv
// Gera e faz o download de um arquivo CSV com os dados brutos.
router.get('/export-csv', async (req, res) => {
  const { clientIds, startDate, endDate } = req.query;

  try {
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (startDate) {
      whereClauses.push(`p.scheduled_at >= $${paramIndex++}`);
      queryParams.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`p.scheduled_at <= $${paramIndex++}`);
      queryParams.push(endDate);
    }
    if (clientIds) {
      const ids = clientIds.split(',').map(id => parseInt(id, 10));
      whereClauses.push(`p.user_id = ANY($${paramIndex++})`);
      queryParams.push(ids);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT
        u.name AS client_name,
        p.scheduled_at AS post_date,
        p.content_text,
        p.linkedin_post_urn,
        p.status,
        COALESCE(pa.impressions, 0) AS impressions,
        COALESCE(pa.reactions, 0) AS reactions,
        COALESCE(pa.comments, 0) AS comments,
        (
          SELECT STRING_AGG(t.name, '; ')
          FROM post_tags pt
          JOIN tags t ON pt.tag_id = t.id
          WHERE pt.post_id = p.id
        ) AS tags
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN post_analytics pa ON p.id = pa.post_id
      ${whereSql}
      ORDER BY p.scheduled_at DESC;
    `;

    const { rows } = await pool.query(query, queryParams);

    const fields = [
      { label: 'Cliente', value: 'client_name' },
      { label: 'Data Postagem', value: 'post_date' },
      { label: 'Texto', value: 'content_text' },
      { label: 'ID Post LinkedIn', value: 'linkedin_post_urn' },
      { label: 'Status', value: 'status' },
      { label: 'Impressoes', value: 'impressions' },
      { label: 'Reacoes', value: 'reactions' },
      { label: 'Comentarios', value: 'comments' },
      { label: 'Tags', value: 'tags' },
    ];
    
    const json2csvParser = new Parser({ fields, header: true });
    const csv = json2csvParser.parse(rows);

    const date = new Date().toISOString().slice(0, 10);
    res.header('Content-Type', 'text/csv');
    res.attachment(`analytics_export_${date}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

module.exports = router;
