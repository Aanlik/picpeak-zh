'use strict';
const { randomUUID } = require('crypto');
const { bridgeConfig, bridgeRequest } = require('./photographyWorkflowBridge');

async function checkpoint(purpose = 'backup') {
  if (!bridgeConfig()) return null;
  const token = randomUUID();
  let checkpoint;
  try {
    const result = await bridgeRequest('/api/state/checkpoint', { method: 'POST', body: { token, purpose } });
    if (result.status !== 200 || result.data?.token !== token || result.data.state?.version !== 1) {
      throw new Error('无法备份精修状态：Bridge 忙碌、不可用或检查点校验失败，备份已停止');
    }
    const activated = await bridgeRequest('/api/state/activate', { method: 'POST', body: { token } });
    if (activated.status !== 200 || !activated.data?.success) throw new Error('精修状态暂停确认失败，备份或恢复已停止');
    checkpoint = result.data;
  } catch (error) {
    // Nothing has been restored/copied yet. The caller owns the ID even if a response was lost.
    const cancelled = await bridgeRequest('/api/state/cancel', { method: 'POST', body: { token } });
    if (![200, 202].includes(cancelled.status)) error.message += '；取消暂停未确认，请在 Bridge 中核对任务状态';
    throw error;
  }
  const timer = setInterval(async () => {
    const renewed = await bridgeRequest('/api/state/renew', { method: 'POST', body: { token: checkpoint.token } });
    if (renewed.status !== 200) checkpoint.renewalError = new Error('精修状态备份锁续期失败，请重新备份');
  }, 60000);
  timer.unref();
  Object.defineProperty(checkpoint, 'timer', { value: timer });
  Object.defineProperty(checkpoint, 'purpose', { value: purpose });
  return checkpoint;
}
async function release(checkpoint) {
  if (!checkpoint) return;
  clearInterval(checkpoint.timer);
  const result = await bridgeRequest('/api/state/release', { method: 'POST', body: { token: checkpoint.token } });
  if (checkpoint.renewalError) throw checkpoint.renewalError;
  if (result.status !== 200) {
    const status = await bridgeRequest('/api/state/status');
    if (status.status === 200 && status.data?.token === null && status.data?.blocked === false) return;
    throw new Error(checkpoint.purpose === 'restore'
      ? '数据恢复已完成，但同步暂停未解除；恢复暂停不会自动到期，请核对 Bridge 状态后手动解除'
      : '无法解除精修状态备份锁，请检查 Bridge；备份暂停最多保持 30 分钟');
  }
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
module.exports = { checkpoint, release, restore, hold, isConfigured: () => Boolean(bridgeConfig()) };
