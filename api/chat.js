import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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

// Keyword-based fallback search (Replace with semantic search for better results)
function searchRelevantChunks(records, question) {
  if (!question) return [];
  
  // Normalize string for matching
  const prepare = str =>
    (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const q = prepare(question);

  // TODO: Replace this with semantic search for better results
  return records.filter(item =>
    prepare(item.content).includes(q) ||
    prepare(item.heading).includes(q) ||
    prepare(item.title).includes(q)
  );
}

/*
  // Example placeholder for semantic search using embeddings
  // async function searchRelevantChunksSemantic(records, question) {
  //   // Get embedding for question and all chunks, then compute cosine similarity
  //   // Return the top-N most similar chunks
  // }
*/

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });

    const { question } = req.body ?? {};
    if (!question || typeof question !== "string" || !question.trim())
      return res.status(400).json({ error: "Missing or invalid 'question' in request body." });

    let contentRecords;
    try {
      contentRecords = extractContentRecords(data);
    } catch (error) {
      console.error("Error extracting content from data:", error);
      return res.status(500).json({ error: "Could not parse website data properly." });
    }

    // Get all relevant chunks (keyword-based for now; see semantic search note above)
    const relevantChunks = searchRelevantChunks(contentRecords, question);
    
    // Limit number of chunks for token safety
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
      .join("\n\n") || "No relevant info found.";

    // System prompt for deep synthesis and reasoning
    const systemPrompt =
      `You are Celestial, the official AI assistant of Government Polytechnic Arvi, developed by Shrihari Chavhan.
Your job is to carefully read and analyze all provided context, not just keyword matches.
- Synthesize relevant information from all sections, combining details and reasoning logically.
- If the data is incomplete or unclear, state this clearly.
- Only answer using the provided context. Do not make up information.
- If no answer is possible, respond with: your words that you dont find any relatable information. 
- For every answer, explain your reasoning step by step before providing the final answer.`;

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "nvidia/nemotron-nano-9b-v2", // You can change to a larger model if you wish
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Context:\n${context}\n\nQuestion: ${question}\n\nCarefully analyze the context above. Explain your reasoning step by step, and then provide your final answer.`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      });
    } catch (apiError) {
      console.error("OpenAI API error:", apiError);
      return res.status(503).json({
        error: "AI service unavailable",
        details: apiError?.message ?? "Failed to get response from AI model",
      });
    }

    const answer =
      completion.choices?.[0]?.message?.content?.trim() ?? "No response from AI.";

    return res.status(200).json({ answer });
  } catch (err) {
    console.error("Unhandled API error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message ?? "Unknown error",
    });
  }
}
