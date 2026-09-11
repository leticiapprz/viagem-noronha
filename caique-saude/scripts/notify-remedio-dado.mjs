// Roda na hora (via repository_dispatch, disparado pelo app quando alguém
// marca "dei o remédio" na Início — ver notifyRemedioDado() no index.html).
// Diferente de send-reminders.mjs (que roda 1x/dia e varre o banco todo
// procurando o que vence), aqui o evento já chega pronto no client_payload:
// só precisamos avisar todo mundo inscrito, MENOS quem marcou.
import webpush from 'web-push';

const FB = 'https://viagem-noronha-default-rtdb.firebaseio.com/caique-saude';
const VAPID_PUBLIC_KEY = 'BPKWtjKRdZgx2eBzyUc4viVT9pZGdfxY3JTK4nG5hEQYTb4Bo2dcCd790-Nq-b2Nto1IJ9td7QagjUEt9ch7AX4';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = 'https://github.com/leticiapprz/viagem-noronha';

if (!VAPID_PRIVATE_KEY) {
  console.error('VAPID_PRIVATE_KEY não configurada (secret do GitHub Actions). Abortando.');
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const nome = process.env.REMEDIO_NOME || 'um remédio';
const quem = process.env.REMEDIO_QUEM || 'Caique';
const by = (process.env.REMEDIO_BY || '').trim();

async function main() {
  const res = await fetch(FB + '/pushSubscriptions.json');
  if (!res.ok) {
    console.error('Falha ao ler inscrições:', res.status);
    process.exit(1);
  }
  const subscriptions = (await res.json()) || {};
  const subIds = Object.keys(subscriptions);
  if (!subIds.length) {
    console.log('Nenhum dispositivo inscrito.');
    return;
  }

  const title = by ? `${by} deu o remédio` : 'Remédio dado';
  const body = `${nome} · ${quem}`;
  const payload = JSON.stringify({ title, body, url: './index.html', tag: `remedio-dado:${Date.now()}` });

  const subscriptionRemovals = [];
  for (const subId of subIds) {
    const raw = subscriptions[subId];
    const owner = raw && typeof raw === 'object' && raw.owner;
    if (by && owner && owner === by) continue; // não notifica quem acabou de marcar
    const sub = raw && raw.subscription ? raw.subscription : raw;
    if (!sub || !sub.endpoint) continue;
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        subscriptionRemovals.push(subId);
      } else {
        console.error(`Falha ao enviar pra ${subId}:`, status || err.message);
      }
    }
  }
  for (const subId of [...new Set(subscriptionRemovals)]) {
    await fetch(FB + '/pushSubscriptions/' + subId + '.json', { method: 'DELETE' });
    console.log('Inscrição expirada removida:', subId);
  }
  console.log('Notificação de remédio dado processada.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
