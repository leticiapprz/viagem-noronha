// Roda 1x por dia via GitHub Actions (.github/workflows/caique-saude-notify.yml).
// Lê o banco (mesmo projeto Firebase da viagem, nó /caique-saude — ver
// PROJECT_MAP.md seção 6), calcula o que vence/atrasou, e manda push real
// (protocolo Web Push padrão, sem depender de Firebase Cloud Messaging) pra
// cada dispositivo inscrito. Marca cada aviso já enviado em `notified` pra
// não repetir todo dia.
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

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function daysDiff(iso) {
  const today = new Date(todayISO() + 'T00:00:00');
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function profileLabel(perfil, pet) {
  if (perfil === 'pet') return (pet && pet.nome) ? pet.nome : 'Pet';
  return 'Caique';
}
function isRemedioAtivo(x, today) {
  if (x.continuo) return !x.inicio || x.inicio <= today;
  if (x.inicio && x.inicio > today) return false;
  if (x.fim && x.fim < today) return false;
  return true;
}

async function main() {
  const res = await fetch(FB + '/.json');
  if (!res.ok) {
    console.error('Falha ao ler o banco:', res.status);
    process.exit(1);
  }
  const data = (await res.json()) || {};
  const exames = Array.isArray(data.exames) ? data.exames : [];
  const vacinas = Array.isArray(data.vacinas) ? data.vacinas : [];
  const remedios = Array.isArray(data.remedios) ? data.remedios : [];
  const banhos = Array.isArray(data.banhos) ? data.banhos : [];
  const pet = data.pet || {};
  const subscriptions = data.pushSubscriptions || {};
  const notified = data.notified || {};
  const today = todayISO();

  const pending = []; // { key, title, body }

  exames.forEach((x) => {
    const quem = profileLabel(x.perfil, pet);
    const tipoLabel = x.categoria === 'consulta' ? 'Consulta' : 'Exame';
    if (x.status === 'a_agendar') {
      pending.push({ key: `exame:${x.id}:precisa-agendar`, title: `Falta agendar: ${x.nome} · ${quem}`, body: 'Ainda sem data marcada.' });
    }
    if (x.status === 'agendado' && x.data) {
      const d = daysDiff(x.data);
      if (d >= 0 && d <= 7) {
        pending.push({ key: `exame:${x.id}:soon`, title: `${tipoLabel}: ${x.nome} · ${quem}`, body: d === 0 ? 'É hoje.' : `Em ${d} dia${d === 1 ? '' : 's'} (${fmtDate(x.data)}).` });
      }
    }
    if (x.resultado === 'aguardando' && x.status === 'realizado') {
      pending.push({ key: `exame:${x.id}:aguardando`, title: `Resultado pendente: ${x.nome} · ${quem}`, body: 'Aguardando resultado do exame.' });
    }
  });

  vacinas.forEach((x) => {
    const quem = profileLabel(x.perfil, pet);
    if (x.proxima) {
      const d = daysDiff(x.proxima);
      if (d < 0) {
        const weekIndex = Math.floor(-d / 7);
        pending.push({ key: `vacina:${x.id}:overdue:${weekIndex}`, title: `Vacina atrasada: ${x.nome} · ${quem}`, body: `Atrasada desde ${fmtDate(x.proxima)}.` });
      } else if (d <= 14) {
        pending.push({ key: `vacina:${x.id}:soon`, title: `Vacina: ${x.nome} · ${quem}`, body: d === 0 ? 'É hoje.' : `Em ${d} dia${d === 1 ? '' : 's'} (${fmtDate(x.proxima)}).` });
      }
    }
  });

  banhos.forEach((x) => {
    const quem = profileLabel(x.perfil, pet);
    if (x.proxima) {
      const d = daysDiff(x.proxima);
      if (d < 0) {
        const weekIndex = Math.floor(-d / 7);
        pending.push({ key: `banho:${x.id}:overdue:${weekIndex}`, title: `Banho/tosa atrasado: ${x.nome} · ${quem}`, body: `Atrasado desde ${fmtDate(x.proxima)}.` });
      } else if (d <= 7) {
        pending.push({ key: `banho:${x.id}:soon`, title: `Banho/tosa: ${x.nome} · ${quem}`, body: d === 0 ? 'É hoje.' : `Em ${d} dia${d === 1 ? '' : 's'} (${fmtDate(x.proxima)}).` });
      }
    }
  });

  const remediosHoje = remedios.filter((x) => isRemedioAtivo(x, today));
  if (remediosHoje.length) {
    pending.push({
      key: `remedios:hoje:${today}`,
      title: 'Remédios de hoje',
      body: remediosHoje.length === 1
        ? `${remediosHoje[0].nome} (${profileLabel(remediosHoje[0].perfil, pet)}).`
        : `${remediosHoje.length} remédios ativos hoje.`,
    });
  }

  const toSend = pending.filter((p) => !notified[p.key]);
  if (!toSend.length) {
    console.log('Nada novo pra notificar hoje.');
    return;
  }

  const subIds = Object.keys(subscriptions);
  if (!subIds.length) {
    console.log(`${toSend.length} aviso(s) novo(s), mas nenhum dispositivo inscrito ainda.`);
  }

  const notifiedUpdates = {};
  const subscriptionRemovals = [];

  for (const item of toSend) {
    const payload = JSON.stringify({ title: item.title, body: item.body, url: './index.html', tag: item.key });
    let sentToAny = subIds.length === 0; // se não há inscritos, marca como "notificado" mesmo assim (evita reprocessar pra sempre)
    for (const subId of subIds) {
      try {
        await webpush.sendNotification(subscriptions[subId], payload);
        sentToAny = true;
      } catch (err) {
        const status = err && err.statusCode;
        if (status === 404 || status === 410) {
          subscriptionRemovals.push(subId);
        } else {
          console.error(`Falha ao enviar "${item.key}" pra ${subId}:`, status || err.message);
        }
      }
    }
    if (sentToAny) notifiedUpdates[item.key] = new Date().toISOString();
  }

  if (Object.keys(notifiedUpdates).length) {
    await fetch(FB + '/notified.json', { method: 'PATCH', body: JSON.stringify(notifiedUpdates) });
    console.log(`Enviado(s) e marcado(s): ${Object.keys(notifiedUpdates).join(', ')}`);
  }
  for (const subId of [...new Set(subscriptionRemovals)]) {
    await fetch(FB + '/pushSubscriptions/' + subId + '.json', { method: 'DELETE' });
    console.log('Inscrição expirada removida:', subId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
