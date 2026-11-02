/** 把上游 HTTP 错误翻译成用户能看懂、能动手的话 */
export function friendlyHttpError(status: number, body: string, baseUrl?: string): string {
  const detail = extractMessage(body)
  switch (status) {
    case 400:
      return `请求被上游拒绝（400）${detail ? `：${detail}` : ''}。常见原因：模型名写错，或该模型不支持工具调用（tool calling）——本产品必须用支持工具调用的模型。`
    case 401:
    case 403:
      return `API Key 无效或没有权限（${status}）${detail ? `：${detail}` : ''}。请到「模型设置」里重新填 Key。`
    case 404:
      return `接口地址不存在（404）${detail ? `：${detail}` : ''}。检查地址是否少了或多了 /v1，或模型名是否拼错。`
    case 429:
      return `触发限流或余额不足（429）${detail ? `：${detail}` : ''}。稍后再试，或换一个 Key / 中转站。`
    case 402:
      return `账户余额不足（402）${detail ? `：${detail}` : ''}。`
    default:
      if (status >= 500) return `上游服务故障（${status}）${detail ? `：${detail}` : ''}。多半是中转站或官方在抖动，稍后重试。`
      return `上游返回 ${status}${detail ? `：${detail}` : ''}`
  }
}

function extractMessage(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof json.error === 'string') return json.error.slice(0, 300)
    if (json.error?.message) return json.error.message.slice(0, 300)
    if (json.message) return json.message.slice(0, 300)
  } catch { /* 不是 JSON */ }
  return text.slice(0, 300)
}

/** 探测 /models 用的 URL（兼容用户填 base / base/v1 / base/v1/chat/completions） */
export function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
}
