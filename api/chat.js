import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import natural from "natural"; // <-- install this: npm i natural

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read JSON data
const rawData = readFileSync(join(__dirname, "../websiteData.json"), "utf-8");
const data = JSON.parse(rawData);

// Flatten nested data with safety checks
function extractContentRecords(websiteData) {
  const records = [];
  for (const page of websiteData) {
    const title = page.title ?? "";
    const url = page.url ?? "";

    if (Array.isArray(page.sections)) {
      for (const section of page.sections) {
        if (typeof section.content === "string" && section.content.trim()) {
          records.push({
            title,
            url,
            heading: section.heading ?? "",
            content: section.content.trim(),
          });
        }
      }
    } else if (typeof page.content === "string" && page.content.trim()) {
      records.push({
        title,
        url,
        heading: "",
        content: page.content.trim(),
      });
    }
  }
  return records;
}

// Improved fuzzy + tokenized search
function searchRelevantChunks(records, question) {
  if (!question) return [];

  const tokenizer = new natural.WordTokenizer();
  const qTokens = tokenizer.tokenize(question.toLowerCase());

  return records.filter(item => {
    const text = `${item.title} ${item.heading} ${item.content}`.toLowerCase();
    // at least one meaningful token must appear in content
    return qTokens.some(token => text.includes(token));
  });
}

// Detect simple greetings
function isGreeting(question) {
  const q = question.toLowerCase().trim();
  return ["hi", "hello", "hey", "good morning", "good evening"].some(g => q.includes(g));
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");           // or your domain
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });

    const { question } = req.body ?? {};
    if (!question || typeof question !== "string" || !question.trim())
      return res.status(400).json({ error: "Missing or invalid 'question' in request body." });

    // Handle casual greetings directly
    if (isGreeting(question)) {
      return res.status(200).json({
        answer: "Hello! 👋 I'm Celestial, the AI assistant of Government Polytechnic Arvi. How can I help you today?",
      });
    }

    // Extract records from dataset
    let contentRecords;
    try {
      contentRecords = extractContentRecords(data);
    } catch (error) {
      console.error("Error extracting content:", error);
      return res.status(500).json({ error: "Could not parse website data." });
    }

    // Use fuzzy search to find relevant info
    const relevantChunks = searchRelevantChunks(contentRecords, question);

    // If nothing relevant found, respond politely
    if (relevantChunks.length === 0) {
      return res.status(200).json({
        answer: "I couldn’t find any related information in the college data for that query.",
      });
    }

    // Prepare context
    const maxChunks = 8;
    const context = relevantChunks
      .slice(0, maxChunks)
      .map(
        (c) =>
          [
            c.title ? `Title: ${c.title}` : "",
            c.heading ? `Heading: ${c.heading}` : "",
            c.content,
          ]
            .filter(Boolean)
            .join("\n")
      )
      .join("\n\n");

    // System role
    const systemPrompt = `You are Celestial, the official AI assistant of Government Polytechnic Arvi, developed by Shrihari Chavhan.
Your job is to answer ONLY using the provided college data.
Analyze the context carefully, reason step by step, and give a clear final answer.
If no info matches, clearly say you don’t find any relatable information.`;

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "nvidia/nemotron-nano-9b-v2",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Context:\n${context}\n\nQuestion: ${question}\n\nExplain your reasoning briefly, then provide the final answer.`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      });
    } catch (apiError) {
      console.error("AI API error:", apiError);
      return res.status(503).json({
        error: "AI service unavailable",
        details: apiError?.message ?? "Failed to get response from AI model",
      });
    }

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "No response from AI.";

    return res.status(200).json({ answer });
  } catch (err) {
    console.error("Unhandled API error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message ?? "Unknown error",
    });
  }
                                   }
