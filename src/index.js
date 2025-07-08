const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const clientRoutes = require('./routes/clients.routes');
const tagRoutes = require('./routes/tags.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const postRoutes = require('./routes/posts.routes');
const publicRoutes = require('./routes/public.routes');
const linkedinRoutes = require('./routes/linkedin.routes'); // Importar nova rota
const scheduler = require('./scheduler');

app.use(cors());
app.use(express.json());

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/linkedin', linkedinRoutes);

// Servir arquivos estáticos do frontend em produção
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));

  // Rota "catch-all" para servir o index.html do React
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('LinkedIn Post Manager API is running in development mode!');
  });
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  scheduler.start();
});
