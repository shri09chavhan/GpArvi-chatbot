import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read JSON the Node.js-compatible way, avoiding import assertion issues
const rawData = readFileSync(join(__dirname, "../websiteData.json"), "utf-8");
const data = JSON.parse(rawData);

// Flatten nested data consistently with safety checks.
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

// Search content, headings, and titles case-insensitively.
function searchRelevantChunks(records, question) {
  if (!question) return [];
  // Normalize: lowercase, remove non-alphanumerics, collapse whitespace
  const prepare = str =>
    (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const q = prepare(question);
  console.log("Question (normalized):", q);
relevantChunks.forEach(chunk => {
  console.log("Matched chunk:", chunk);
});

  return records.filter(item =>
    prepare(item.content).includes(q) ||
    prepare(item.heading).includes(q) ||
    prepare(item.title).includes(q)
  );
  
}

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
      return res
        .status(400)
        .json({ error: "Missing or invalid 'question' in request body." });

    let contentRecords;
    try {
      contentRecords = extractContentRecords(data);
    } catch (error) {
      console.error("Error extracting content from data:", error);
      return res
        .status(500)
        .json({ error: "Could not parse website data properly." });
    }

    const relevantChunks = searchRelevantChunks(contentRecords, question);

    // Limit number of chunks for token length safety
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

    const completion = await openai.chat.completions.create({
      model: "nvidia/nemotron-nano-9b-v2",
      messages: [
        {
          role: "system",
          content:
            "You are Celestial, the official AI assistant of Government Polytechnic Arvi, developed by Shrihari Chavhan. Answer politely " +
            "and precisely only using provided official college data. If no relevant information is found, respond exactly with what you found in data relevant to user query",
        },
        { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

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
