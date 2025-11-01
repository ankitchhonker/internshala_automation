
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

async function getAIAnswers() {
  // Build a concise prompt
  const prompt = `
You are an assistant generating short professional answers for an internship application.
Internship Title: full stack
Applicant: ankit — Skills: MERN TECH C++, javascript.
Form fields:
 

Respond **only** in valid JSON mapping field label → answer.
`;
  const response = await ai.models.generateContent({
    contents: [
      {
        role: "user",
        contents: prompt
      },
    ],
  });

  console.log(response.text);

   
  try {
    answers = JSON.parse(text);
  } catch (err) {
    sendLog("⚠️ Could not parse AI response as JSON. Response: " + text);
    // fallback: map each field to generic answer
    fields.forEach(f => { answers[f.label] = "Available upon request."; });
  }
  return answers;
}