const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  // Pega o token do header
  const token = req.header('x-auth-token');

  // Checa se não há token
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  // Verifica o token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_default_jwt_secret');
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
