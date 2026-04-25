import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { RAPAS_ANALYSIS_PROMPT } from '../utils/prompts';

const app = new Hono().basePath('/api');

type Bindings = {
  QWEN_API_KEY: string;
  QWEN_BASE_URL: string;
  QWEN_MODEL_NAME: string;
};

app.post('/analyze', async (c) => {
  const startTime = Date.now();
  try {
    const body = await c.req.json();
    const env = c.env as Bindings;

    const { user_id, analysis_period, analysis_mode, input_data } = body;

    if (!env.QWEN_API_KEY) {
      return c.json({ error: 'Missing QWEN_API_KEY environment variable' }, 500);
    }

    const modelName = env.QWEN_MODEL_NAME || "qwen-plus";
    const baseURL = (env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, '');

    // Optimization: avoid re-parsing if it's already a string or already an object
    let dataStr = typeof input_data === 'string' ? input_data : JSON.stringify(input_data);
    
    const inputContext = `
诉求人ID: ${user_id || '未知'}
分析周期: ${analysis_period || '未指定'}
分析模式: ${analysis_mode || '标准研判'}
数据内容:
${dataStr}
`;

    console.log(`[${user_id}] Starting analysis with model: ${modelName}`);

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 28000); // 28s timeout to be safe
    });

    // Create the AI request promise
    const aiRequestPromise = (async () => {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.QWEN_API_KEY}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: RAPAS_ANALYSIS_PROMPT },
            { role: "user", content: `请分析以下诉求数据：\n\n${inputContext}` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI_API_ERROR: ${response.status} - ${errText}`);
      }

      return await response.json();
    })();

    // Race the AI request against the timeout
    const completion: any = await Promise.race([aiRequestPromise, timeoutPromise]);
    
    const resultStr = completion.choices[0].message.content;
    if (!resultStr) {
      throw new Error("AI failed to generate a report content");
    }

    const result = JSON.parse(resultStr);
    const duration = Date.now() - startTime;
    console.log(`[${user_id}] Analysis completed in ${duration}ms`);

    return c.json({
      ...result,
      duration,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[Analysis Error after ${duration}ms]:`, error);

    if (error.message === 'TIMEOUT') {
      return c.json({ 
        error: '分析请求超时（28秒）。这通常是因为数据量较大或 AI 响应较慢。',
        duration
      }, 504);
    }

    return c.json({ 
      error: error.message || '未知服务器错误',
      duration
    }, 500);
  }
});

export const onRequest = handle(app);
