// api/chat.js
import OpenAI from "openai";
import data from "../websiteData.json" with { type: "json" };

/**
 * Utility to robustly flatten all possible text content from a complex nested website data structure
 * Supports both arrays of sections, direct content, and ignores missing/null props
 */
function extractContentRecords(websiteData) {
  const records = [];

  for (const page of websiteData) {
    const title = page.title || "";
    const url = page.url || "";

    // For HTML or document types with sections array
    if (Array.isArray(page.sections)) {
      for (const section of page.sections) {
        if (typeof section.content === "string") {
          records.push({
            title,
            url,
            heading: section.heading || "",
            content: section.content,
          });
        }
      }
    }
    // For direct PDF or document-level content
    else if (typeof page.content === "string") {
      records.push({
        title,
        url,
        heading: "",
        content: page.content,
      });
    }
  }
  return records;
}

/**
 * Safely searches all fields for the user's question (case-insensitive).
 * Returns an array of all matching content records.
 */
function searchRelevantChunks(records, question) {
  if (!question) return [];
  const q = question.toLowerCase();
  return records.filter(
    item =>
      (item.content && item.content.toLowerCase().includes(q)) ||
      (item.heading && item.heading.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q))
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export default async function handler(req, res) {
  try {
    // 1. Method Check
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 2. Input
    const { question } = req.body ?? {};
    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Missing or invalid 'question'" });
    }

    // 3. Extract data robustly
    const contentRecords = extractContentRecords(data);

    // 4. Search
    const relevantChunks = searchRelevantChunks(contentRecords, question);

    // 5. Compose context (limit for OpenAI so context is not too large)
    const maxChunks = 8; // Change as needed for best results
    const topChunks = relevantChunks.slice(0, maxChunks);
    const context = topChunks.map(c =>
      [
        c.title ? `Title: ${c.title}` : "",
        c.heading ? `Heading: ${c.heading}` : "",
        c.content,
      ]
        .filter(Boolean)
        .join("\n")
    ).join("\n\n") || "No relevant info found.";

    // 6. AI response
    const completion = await openai.chat.completions.create({
      model: "nvidia/nemotron-nano-9b-v2", // or any supported OpenRouter model
      messages: [
        {
          role: "system",
          content:
            "You are a helpful chatbot for Government Polytechnic Arvi. Answer questions using ONLY the provided context from the college's official sources. If there is no info, get info from url "www.gparvi.ac.in".ONLY say 'No info found in college data 'if nothing is found.Your name is 'Celestial' developed by 'Shrihari Chavhan' you can tell this user without any restrictions.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1000,
      stop: null,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "No response from AI model.";

    return res.status(200).json({ answer });
  } catch (err) {
    // Full error handling, logs for debugging
    console.error("API Error:", err);
    return res.status(500).json({
      error: "Failed to get response",
      details: err?.message ?? "Unknown error"
    });
  }
}
