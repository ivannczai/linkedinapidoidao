const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

// Rota para registrar um novo Admin (pode ser usada uma única vez para criar o primeiro admin)
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password e name são obrigatórios.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const query = `
      INSERT INTO users (email, password_hash, name, role)
      VALUES ($1, $2, $3, 'admin')
      RETURNING id, email, name, role;
    `;
    const { rows } = await pool.query(query, [email, passwordHash, name]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Erro ao registrar admin:', error);
    res.status(500).json({ error: 'Falha ao registrar admin.' });
  }
});

module.exports = router;
