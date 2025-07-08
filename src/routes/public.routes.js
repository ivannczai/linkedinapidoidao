const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// @route   GET api/public/client-info/:userId
// @desc    Obter o nome de um cliente para a página de conexão
router.get('/client-info/:userId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name FROM users WHERE id = $1 AND role = \'client\'', [req.params.userId]);
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Client not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
