const express = require('express');
const querystring = require('querystring');
const linkedinService = require('../services/linkedin.service');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// @route   POST api/auth/login
// @desc    Autenticar qualquer usuário (admin ou client)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET || 'your_default_jwt_secret',
      { expiresIn: '5h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token, role: user.role }); // Retorna a role para o frontend
      }
    );
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Falha no login.' });
  }
});

// Ponto de entrada para o fluxo de conexão de um cliente
router.get('/linkedin/connect/:userId', (req, res) => {
  const { userId } = req.params;
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');

  const params = querystring.stringify({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    scope: 'r_basicprofile w_member_social r_member_postAnalytics', // Escopos originais
    state: state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

// Callback único para a aplicação
router.get('/linkedin/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error) return res.status(400).send(`Erro do LinkedIn: ${req.query.error_description}`);
  
  const { userId } = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));

  try {
    const tokenData = await linkedinService.getAccessToken(code);
    const profileData = await linkedinService.getProfile(tokenData.access_token);
    
    const linkedinUrn = profileData.id; // O ID do usuário já vem como URN: 'urn:li:member:...'
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

    const query = `
      INSERT INTO linkedin_accounts (user_id, linkedin_id, access_token, refresh_token, token_expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        linkedin_id = EXCLUDED.linkedin_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at;
    `;
    await pool.query(query, [userId, linkedinUrn, tokenData.access_token, tokenData.refresh_token, expiresAt]);
    
    // Atualiza o nome do usuário no nosso DB com o nome do perfil do LinkedIn
    await pool.query('UPDATE users SET name = $1 WHERE id = $2', [`${profileData.localizedFirstName} ${profileData.localizedLastName}`, userId]);

    res.redirect('http://localhost:5173/connection-success');
  } catch (err) {
    console.error(err);
    res.status(500).send('Falha na autenticação.');
  }
});

module.exports = router;
