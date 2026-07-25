import dotenv from "dotenv";
dotenv.config();

const key = process.env.GROQ_API_KEY || "";
const model = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";
console.log("model:", model);
console.log("key length:", key.length);

const body = {
  model,
  temperature: 0.1,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: "Return strict JSON only." },
    {
      role: "user",
      content: JSON.stringify({
        transcript: "click login",
        elements: [{ element: "button", selector: "#login", text: "Login" }],
      }),
    },
  ],
};

const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

console.log("status:", res.status);
const text = await res.text();
console.log(text);
