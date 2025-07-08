const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAnalysis(postData) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `
    You are a world-class social media strategist analyzing LinkedIn performance for a high-level executive. Here is the data for the last 30 days:

    ${JSON.stringify(postData, null, 2)}

    Based on this data, provide a concise, professional analysis covering the following points:
    1.  **Top Performing Theme:** Identify the Content Pillar that generated the highest overall engagement (reactions + comments). Provide a hypothesis for why this theme resonates with the audience.
    2.  **Format Analysis:** Compare the performance of different post formats. Which format is driving more impressions and which is driving more comments?
    3.  **Outlier Identification:** Pinpoint the single best-performing post (the "home run") and the single worst-performing post (the "dud"). For each, analyze the post's text and tags to suggest why it performed the way it did.
    4.  **Strategic Recommendation:** Based on this analysis, suggest one concrete action for the next content cycle.
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    return text;
  } catch (error) {
    console.error('Error generating analysis with Gemini:', error);
    throw new Error('Failed to generate AI analysis.');
  }
}

module.exports = { generateAnalysis };
