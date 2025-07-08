const axios = require('axios');
const querystring = require('querystring');

const LINKEDIN_API_URL = 'https://api.linkedin.com';
const LINKEDIN_OAUTH_URL = 'https://www.linkedin.com/oauth/v2';

const getAccessToken = async (code) => {
  const response = await axios.post(`${LINKEDIN_OAUTH_URL}/accessToken`, querystring.stringify({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return response.data;
};

const getProfile = async (accessToken) => {
  const response = await axios.get(`${LINKEDIN_API_URL}/v2/me`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'LinkedIn-Version': '202506' },
  });
  return response.data;
};

const publishPost = async (accessToken, authorId, text) => {
  const requestBody = {
    author: `urn:li:person:${authorId}`,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
  };

  const response = await axios.post(
    `${LINKEDIN_API_URL}/rest/posts`,
    requestBody,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'LinkedIn-Version': '202506',
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    }
  );
  return response.headers['x-restli-id'];
};

const getPostAnalytics = async (accessToken, postUrn) => {
  // O formato correto da entidade é (share:URN), com o URN codificado.
  const entityValue = `(share:${encodeURIComponent(postUrn)})`;

  const params = new URLSearchParams({
    q: 'entity',
    aggregation: 'TOTAL',
  });

  const metrics = ['IMPRESSION', 'REACTION', 'COMMENT'];
  const results = {};

  for (const metric of metrics) {
    // Construímos a URL manualmente para garantir a codificação correta apenas do URN
    const finalParams = `${params.toString()}&entity=${entityValue}&queryType=${metric}`;
    const response = await axios.get(`${LINKEDIN_API_URL}/rest/memberCreatorPostAnalytics?${finalParams}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'LinkedIn-Version': '202506',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    console.log(`--- Resposta da API de Analytics para ${metric} ---`);
    console.log(JSON.stringify(response.data, null, 2));
    results[metric.toLowerCase()] = response.data.elements[0]?.count || 0;
  }
  
  return {
    impressions: results.impression,
    reactions: results.reaction,
    comments: results.comment,
  };
};

module.exports = {
  getAccessToken,
  getProfile,
  publishPost,
  getPostAnalytics,
};
