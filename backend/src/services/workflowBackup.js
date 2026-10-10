'use strict';
const { bridgeConfig, bridgeRequest } = require('./photographyWorkflowBridge');

async function checkpoint() {
  if (!bridgeConfig()) return null;
  const result = await bridgeRequest('/api/state/checkpoint', { method: 'POST', body: {} });
  if (result.status !== 200 || !result.data?.token || result.data.state?.version !== 1) {
    throw new Error('无法备份精修状态：Bridge 不可用或版本不支持，备份已停止');
  }
  const checkpoint = result.data;
  const timer = setInterval(async () => {
    const renewed = await bridgeRequest('/api/state/renew', { method: 'POST', body: { token: checkpoint.token } });
    if (renewed.status !== 200) checkpoint.renewalError = new Error('精修状态备份锁续期失败，请重新备份');
  }, 60000);
  timer.unref();
  Object.defineProperty(checkpoint, 'timer', { value: timer });
  return checkpoint;
}
async function release(checkpoint) {
  if (!checkpoint) return;
  clearInterval(checkpoint.timer);
  const result = await bridgeRequest('/api/state/release', { method: 'POST', body: { token: checkpoint.token } });
  if (checkpoint.renewalError) throw checkpoint.renewalError;
  if (result.status !== 200) throw new Error('无法解除精修状态备份锁，请检查 Bridge；锁最多保持 30 分钟');
}
async function restore(state, checkpoint) {
  if (!checkpoint) throw new Error('恢复精修状态需要可连接的 Bridge');
  const result = await bridgeRequest('/api/state/restore', { method: 'POST', body: { state, token: checkpoint.token } });
  if (result.status !== 200) throw new Error(`精修状态恢复失败（HTTP ${result.status}），请保留备份并检查挂载配置`);
}
async function hold(checkpoint, reason) {
  const result = await bridgeRequest('/api/state/block', { method: 'POST', body: { token: checkpoint.token, reason } });
  if (result.status !== 200) throw new Error('无法持久化恢复暂停，请保持服务停止并人工核对');
  clearInterval(checkpoint.timer);
}
module.exports = { checkpoint, release, restore, hold };
