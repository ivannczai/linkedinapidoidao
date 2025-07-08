const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// @route   GET api/posts
// @desc    Admin lista todos os posts com filtros e paginação
router.get('/', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  const { clientIds, status, startDate, endDate, page = 1, limit = 10 } = req.query;

  try {
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (clientIds) {
      whereClauses.push(`p.user_id = ANY($${paramIndex++})`);
      queryParams.push(clientIds.split(','));
    }
    if (status) {
      whereClauses.push(`p.status = $${paramIndex++}`);
      queryParams.push(status);
    }
    if (startDate) {
      whereClauses.push(`p.scheduled_at >= $${paramIndex++}`);
      queryParams.push(startDate);
    }
    if (endDate) {
      whereClauses.push(`p.scheduled_at <= $${paramIndex++}`);
      queryParams.push(endDate);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const postsQuery = `
      SELECT p.*, u.name as client_name 
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ${whereSql}
      ORDER BY p.scheduled_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    const countQuery = `SELECT COUNT(p.id) FROM posts p ${whereSql};`;

    const [postsResult, countResult] = await Promise.all([
      pool.query(postsQuery, [...queryParams, limit, offset]),
      pool.query(countQuery, queryParams)
    ]);

    res.json({
      data: postsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

  } catch (error) {
    console.error('Error fetching all posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts.' });
  }
});

// @route   PATCH api/posts/:id/status
// @desc    Admin atualiza o status de um post
router.patch('/:id/status', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required.' });

  try {
    const query = `UPDATE posts SET status = $1 WHERE id = $2 RETURNING *;`;
    const { rows } = await pool.query(query, [status, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ msg: 'Post not found.' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(500).json({ error: 'Failed to update post status.' });
  }
});

// @route   DELETE api/posts/:id
// @desc    Admin deleta um post do sistema
router.delete('/:id', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: 'Acesso negado.' });

  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post.' });
  }
});

module.exports = router;
