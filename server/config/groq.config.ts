import Groq from "groq-sdk";
import config from ".";

const client = new Groq({
  apiKey: config.GROQ_API_KEY,
});

export default client;
