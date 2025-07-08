const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// @route   DELETE api/linkedin/connection
// @desc    Cliente deleta sua própria conexão com o LinkedIn
router.delete('/connection', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM linkedin_accounts WHERE user_id = $1', [req.user.id]);
    if (rowCount === 0) {
      return res.status(404).json({ msg: 'Conexão não encontrada.' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting LinkedIn connection:', error);
    res.status(500).json({ error: 'Falha ao deletar conexão.' });
  }
});

module.exports = router;
