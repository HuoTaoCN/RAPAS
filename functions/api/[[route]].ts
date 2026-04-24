import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import OpenAI from 'openai';
import { RAPAS_ANALYSIS_PROMPT } from '../utils/prompts';

const app = new Hono().basePath('/api');

type Bindings = {
  QWEN_API_KEY: string;
  QWEN_BASE_URL: string;
  QWEN_MODEL_NAME: string;
};

app.post('/analyze', async (c) => {
  try {
    const body = await c.req.json();
    const env = c.env as Bindings;

    const { user_id, analysis_period, analysis_mode, input_data } = body;

    if (!env.QWEN_API_KEY) {
      return c.json({ error: 'Missing QWEN_API_KEY environment variable' }, 500);
    }

    const openai = new OpenAI({
      apiKey: env.QWEN_API_KEY,
      baseURL: env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });

    const modelName = env.QWEN_MODEL_NAME || "qwen3.6-plus";

    // Prepare the input for AI
    let inputContext = '';
    const rawData = typeof input_data === 'string' ? (()=>{try{return JSON.parse(input_data)}catch(e){return input_data}})() : input_data;
    
    inputContext = `
诉求人ID: ${user_id || '未知'}
分析周期: ${analysis_period || '未指定'}
分析模式: ${analysis_mode || '标准研判'}
数据内容:
${JSON.stringify(rawData, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: RAPAS_ANALYSIS_PROMPT
        },
        {
          role: "user",
          content: `请分析以下诉求数据：\n\n${inputContext}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, 
    });

    const resultStr = completion.choices[0].message.content;

    if (!resultStr) {
      throw new Error("AI failed to generate a report");
    }

    const result = JSON.parse(resultStr);

    return c.json({
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("RAPAS Analysis Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export const onRequest = handle(app);
