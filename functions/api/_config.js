// API密钥配置（base64编码，同时支持环境变量覆盖）
export function getDeepSeekKey(env) {
  if (env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY;
  try { return atob('c2stMTBlNzdkNDU3NjlhNDk1ODk2NTBiNTcwOWUxZmU4ZWM='); } catch { return ''; }
}
export function getAmapKey(env) {
  if (env.AMAP_KEY) return env.AMAP_KEY;
  try { return atob('ZDQyY2NhODFhOTc3NDZmYzk0ODhhNmZiZGVmZjc4Nzg='); } catch { return ''; }
}
export function getVolcanoKey(env) {
  if (env.VOLCANO_API_KEY) return env.VOLCANO_API_KEY;
  try { return atob('YXBpa2V5LTIwMjYwODE1MjIxODI5LWxrd3Fr'); } catch { return ''; }
}
