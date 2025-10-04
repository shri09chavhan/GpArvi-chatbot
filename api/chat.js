import OpenAI from "openai";
import data from "../websiteData.json" with { type: "json" };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "Missing question" });
  
  // Add safety checks for undefined properties
  const relevantChunks = data.filter(d =>
    (d.content && d.content.toLowerCase().includes(question.toLowerCase())) ||
    (d.section && d.section.toLowerCase().includes(question.toLowerCase()))
  );
  
  const context = relevantChunks.map(c => c.content || '').join("\n") || "No relevant info found.";
  
  try {
    const completion = await openai.chat.completions.create({
      model: "nvidia/nemotron-nano-9b-v2",
      messages: [
        { role: "system", content: "You are a chatbot that answers using the provided context only." },
        { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }
      ],
    });
    
    res.status(200).json({ answer: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get response" });
  }
}
