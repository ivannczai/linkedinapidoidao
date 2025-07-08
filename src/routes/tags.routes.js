const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// @route   GET api/tags
// @desc    List all available tags
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tags ORDER BY category, name');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags.' });
  }
});

// @route   POST api/tags
// @desc    Create a new tag
router.post('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Access denied.' });
  }

  const { name, category } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required.' });
  }

  try {
    const query = `
      INSERT INTO tags (name, category)
      VALUES ($1, $2)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [name, category]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating tag:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: `Tag "${name}" already exists in category "${category}".` });
    }
    res.status(500).json({ error: 'Failed to create tag.' });
  }
});

module.exports = router;
