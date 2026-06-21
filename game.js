let eventsData = null;
let gameState = null;
let isRunning = false;

async function loadEvents()
{
  const res = await fetch('events.json');
  eventsData = await res.json();
}

function randInt(min, max)
{
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFrom(arr)
{
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwo(arr)
{
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function formatText(template, a, b)
{
  let result = template.replace(/\{A\}/g, `<span class="nameTag">${a.name}</span>`);
  if (b)
  {
    result = result.replace(/\{B\}/g, `<span class="nameTag">${b.name}</span>`);
  }
  return result;
}

function getBestWeapon(participant)
{
  const weaponIds = eventsData.shopItems
    .filter(i => i.damage > 0)
    .sort((a, b) => b.damage - a.damage)
    .map(i => i.id);
  for (const wId of weaponIds)
  {
    if (participant.inventory.includes(wId))
    {
      return eventsData.shopItems.find(i => i.id === wId);
    }
  }
  return null;
}

function getDefense(participant)
{
  let def = 0;
  for (const iId of participant.inventory)
  {
    const item = eventsData.shopItems.find(i => i.id === iId);
    if (item && item.defense)
    {
      def += item.defense;
    }
  }
  return def;
}

function killParticipant(participant, killer, cause)
{
  participant.alive = false;
  participant.causeOfDeath = cause || randFrom(eventsData.deathMessages);
  participant.killedBy = killer ? killer.name : null;
  if (killer)
  {
    killer.kills++;
  }
  gameState.deadThisDay.push(participant);
}

function tryBuyItems(participant)
{
  const needsHealing = participant.health < 70;

  const affordable = eventsData.shopItems
    .filter(i =>
    {
      if (i.cost > participant.money) return false;
      if (i.consumable) return needsHealing;
      return !participant.inventory.includes(i.id);
    })
    .sort((a, b) => b.cost - a.cost);

  const messages = [];
  for (const item of affordable)
  {
    if (participant.money >= item.cost)
    {
      participant.money -= item.cost;
      if (item.consumable && item.heal)
      {
        const before = participant.health;
        participant.health = Math.min(100, participant.health + item.heal);
        const gained = participant.health - before;
        messages.push(`<span class="nameTag">${participant.name}</span> spent $${item.cost} on a <strong>${item.name}</strong> and used it immediately, recovering ${gained} HP. (${participant.health} HP)`);
      }
      else
      {
        participant.inventory.push(item.id);
        messages.push(`<span class="nameTag">${participant.name}</span> spent $${item.cost} on a <strong>${item.name}</strong>. ${item.description}`);
      }
    }
  }
  return messages;
}

function resolvePortal(attacker, defender)
{
  const msg = randFrom(eventsData.portalEvents);
  const damage = randInt(20, 60);
  defender.health -= Math.max(0, damage - getDefense(defender));
  return formatText(msg, attacker, defender);
}

function resolveAdmin(attacker, defender)
{
  const msg = randFrom(eventsData.adminEvents);
  defender.health = 0;
  return formatText(msg, attacker, defender);
}

function resolveCombat(attacker, defender)
{
  const weapon = getBestWeapon(attacker);
  let damage = 8;
  let combatMsg;

  if (weapon)
  {
    const combatEntry = eventsData.combatEvents.find(c => c.weapon === weapon.id);
    combatMsg = combatEntry
      ? formatText(combatEntry.text, attacker, defender)
      : formatText(randFrom(eventsData.baseCombatMessages), attacker, defender);

    if (weapon.special === 'admin')
    {
      return { text: resolveAdmin(attacker, defender), damage: 999 };
    }
    if (weapon.special === 'portal')
    {
      const portalText = resolvePortal(attacker, defender);
      return { text: portalText, damage: 0 };
    }
    damage = weapon.damage;
  }
  else
  {
    combatMsg = formatText(randFrom(eventsData.baseCombatMessages), attacker, defender);
  }

  const actualDamage = Math.max(0, damage - getDefense(defender));
  defender.health -= actualDamage;
  return { text: combatMsg, damage: actualDamage };
}

function generateDayEvents()
{
  const alive = gameState.participants.filter(p => p.alive);
  if (alive.length < 2)
  {
    return;
  }

  const dayLog = [];
  gameState.deadThisDay = [];

  const guaranteeElim = gameState.day % 5 === 0 && gameState.day > 0;
  let elimHappened = false;

  const shopMessages = [];
  alive.forEach(p =>
  {
    const msgs = tryBuyItems(p);
    msgs.forEach(m => shopMessages.push(m));
  });
  if (shopMessages.length)
  {
    dayLog.push({ type: 'shop', messages: shopMessages });
  }

  const eventCount = Math.max(3, Math.floor(alive.length * 0.8));
  const shuffled = [...alive].sort(() => Math.random() - 0.5);

  for (let i = 0; i < eventCount && shuffled.filter(p => p.alive).length > 1; i++)
  {
    const aliveNow = shuffled.filter(p => p.alive);
    if (aliveNow.length < 1)
    {
      break;
    }

    const [a, b] = aliveNow.length >= 2 ? pickTwo(aliveNow) : [aliveNow[0], null];
    const roll = Math.random();

    if (roll < 0.30 && b)
    {
      const { text, damage } = resolveCombat(a, b);
      const hpMsg = b.health > 0
        ? ` <span class="nameTag">${b.name}</span> is at ${b.health} HP.`
        : '';
      dayLog.push({ type: 'combat', text: `${text} (${Math.max(0, damage)} damage)${hpMsg}` });

      if (b.health <= 0 && b.alive)
      {
        killParticipant(b, a, null);
        elimHappened = true;
      }
    }
    else if (roll < 0.38 && a.health < 80)
    {
      const ev = randFrom(eventsData.healEvents);
      const healAmt = randInt(10, 30);
      const before = a.health;
      a.health = Math.min(100, a.health + healAmt);
      const gained = a.health - before;
      const text = formatText(ev.text, a, b);
      dayLog.push({ type: 'heal', text: `${text} <em>(+${gained} HP → ${a.health} HP)</em>` });
    }
    else if (roll < 0.45)
    {
      const followUps = eventsData.followUpEvents.filter(e => a.flags[e.requireFlag]);
      if (followUps.length)
      {
        const ev = randFrom(followUps);
        let text = formatText(ev.text, a, b);
        if (ev.moneyGain)
        {
          a.money += ev.moneyGain;
          text += ` (+$${ev.moneyGain})`;
        }
        if (ev.healthGain)
        {
          a.health = Math.min(100, a.health + ev.healthGain);
          text += ` (+${ev.healthGain} HP)`;
        }
        dayLog.push({ type: 'followup', text });
      }
      else
      {
        const ev = randFrom(eventsData.normalEvents);
        processNormalEvent(ev, a, b, dayLog);
      }
    }
    else if (roll < 0.70)
    {
      const ev = randFrom(eventsData.normalEvents);
      processNormalEvent(ev, a, b, dayLog);
    }
    else
    {
      const ev = randFrom(eventsData.randomEvents);
      let text = formatText(ev.text, a, b);
      if (ev.moneyGain)
      {
        a.money += ev.moneyGain;
        text += ` (+$${ev.moneyGain})`;
      }
      if (ev.moneyLoss && b)
      {
        b.money = Math.max(0, b.money - ev.moneyLoss);
        text += ` (${b.name} -$${ev.moneyLoss})`;
      }
      dayLog.push({ type: 'random', text });
    }
  }

  if (guaranteeElim && !elimHappened)
  {
    const aliveNow = gameState.participants.filter(p => p.alive);
    if (aliveNow.length >= 2)
    {
      const [hunter, prey] = pickTwo(aliveNow);
      const weapon = getBestWeapon(hunter);
      let elim;
      if (weapon && weapon.special === 'admin')
      {
        elim = resolveAdmin(hunter, prey);
        prey.health = 0;
      }
      else
      {
        const damage = weapon ? weapon.damage + randInt(10, 30) : randInt(40, 80);
        prey.health -= damage;
        elim = `${formatText(randFrom(eventsData.baseCombatMessages), hunter, prey)} The hit deals ${damage} damage, a decisive blow.`;
      }
      dayLog.push({ type: 'combat forced', text: elim });
      if (prey.health <= 0 && prey.alive)
      {
        killParticipant(prey, hunter, null);
      }
    }
  }

  if (gameState.deadThisDay.length > 0)
  {
    gameState.deadThisDay.forEach(d =>
    {
      dayLog.push({ type: 'death', text: `<span class="nameTag deathName">${d.name}</span> ${d.causeOfDeath}` });
    });
  }

  gameState.eventLog.push({ day: gameState.day, events: dayLog });
  gameState.day++;
}

function processNormalEvent(ev, a, b, dayLog)
{
  let text = formatText(ev.text, a, b);
  if (ev.setFlag)
  {
    a.flags[ev.setFlag] = true;
  }
  dayLog.push({ type: 'normal', text });
}

function checkWinner()
{
  const alive = gameState.participants.filter(p => p.alive);
  return alive.length === 1
    ? alive[0]
    : alive.length === 0
      ? gameState.participants[gameState.participants.length - 1]
      : null;
}

function startGame()
{
  const input = document.getElementById('namesInput').value.trim();
  const names = input.split('\n').map(n => n.trim()).filter(n => n.length > 0);

  if (names.length < 2)
  {
    showToast('Enter at least 2 participants!');
    return;
  }

  gameState = {
    participants: names.map(name => ({
      name,
      alive: true,
      health: 100,
      money: randInt(10, 50),
      inventory: [],
      flags: {},
      kills: 0,
      causeOfDeath: null,
      killedBy: null
    })),
    eventLog: [],
    day: 1,
    deadThisDay: []
  };

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'grid';
  renderGame();
}

function nextDay()
{
  if (!gameState)
  {
    return;
  }
  const winner = checkWinner();
  if (winner)
  {
    showWinner(winner);
    return;
  }
  generateDayEvents();
  renderGame();
  const logEl = document.getElementById('eventLog');
  logEl.scrollTop = logEl.scrollHeight;

  const w = checkWinner();
  if (w)
  {
    setTimeout(() => showWinner(w), 400);
  }
}

async function runToEnd()
{
  if (!gameState || isRunning)
  {
    return;
  }
  isRunning = true;
  document.getElementById('runEndBtn').disabled = true;
  document.getElementById('nextDayBtn').disabled = true;

  while (!checkWinner())
  {
    generateDayEvents();
    renderGame();
    const logEl = document.getElementById('eventLog');
    logEl.scrollTop = logEl.scrollHeight;
    await new Promise(r => setTimeout(r, 300));
  }

  isRunning = false;
  document.getElementById('runEndBtn').disabled = false;
  document.getElementById('nextDayBtn').disabled = false;
  const w = checkWinner();
  if (w)
  {
    setTimeout(() => showWinner(w), 400);
  }
}

function renderGame()
{
  renderLog();
  renderParticipants();
  renderDead();

  const alive = gameState.participants.filter(p => p.alive);
  const dead = gameState.participants.filter(p => !p.alive);

  document.getElementById('aliveCount').textContent = alive.length;
  document.getElementById('deadCount').textContent = dead.length;
  document.getElementById('dayBadge').textContent = `Day ${gameState.day - 1}`;
}

const eventTypeLabel = {
  normal: 'EVENT',
  followup: 'FOLLOW-UP',
  random: 'RANDOM',
  combat: 'COMBAT',
  'combat forced': 'COMBAT',
  shop: 'SHOP',
  heal: 'HEAL',
  death: 'ELIMINATED'
};

function renderLog()
{
  const logEl = document.getElementById('eventLog');
  logEl.innerHTML = '';

  gameState.eventLog.forEach(dayEntry =>
  {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'dayHeader';
    dayHeader.textContent = `DAY ${dayEntry.day}`;
    logEl.appendChild(dayHeader);

    dayEntry.events.forEach(ev =>
    {
      if (ev.type === 'shop')
      {
        ev.messages.forEach(msg =>
        {
          const el = document.createElement('div');
          el.className = 'logEntry shopEntry';
          el.innerHTML = `<span class="logTag shopTag">SHOP</span>${msg}`;
          logEl.appendChild(el);
        });
        return;
      }
      const el = document.createElement('div');
      el.className = `logEntry ${ev.type === 'death' ? 'deathEntry' : ev.type === 'combat' || ev.type === 'combat forced' ? 'combatEntry' : ev.type === 'heal' ? 'healEntry' : ''}`;
      const tag = eventTypeLabel[ev.type] || 'EVENT';
      const tagClass = ev.type === 'death'
        ? 'deathTag'
        : ev.type.startsWith('combat')
          ? 'combatTag'
          : ev.type === 'followup'
            ? 'followTag'
            : ev.type === 'heal'
              ? 'healTag'
              : 'eventTag';
      el.innerHTML = `<span class="logTag ${tagClass}">${tag}</span>${ev.text}`;
      logEl.appendChild(el);
    });
  });
}

function renderParticipants()
{
  const el = document.getElementById('aliveList');
  el.innerHTML = '';
  gameState.participants.filter(p => p.alive).forEach(p =>
  {
    const card = document.createElement('div');
    card.className = 'participantCard';
    const hpColor = p.health > 60 ? '#22c55e' : p.health > 30 ? '#f59e0b' : '#ef4444';
    const items = p.inventory.map(iId =>
    {
      const item = eventsData.shopItems.find(i => i.id === iId);
      return item ? `<span class="itemTag ${item.tier}">${item.name}</span>` : '';
    }).join('');
    card.innerHTML = `
      <div class="cardName">${p.name}</div>
      <div class="cardStats">
        <div class="hpBar"><div class="hpFill" style="width:${Math.max(0,p.health)}%;background:${hpColor}"></div></div>
        <div class="statRow"><span>❤️ ${Math.max(0,p.health)}</span><span>💰 $${p.money}</span><span>⚔️ ${p.kills}</span></div>
      </div>
      ${items ? `<div class="itemList">${items}</div>` : ''}
    `;
    el.appendChild(card);
  });
}

function renderDead()
{
  const el = document.getElementById('deadList');
  el.innerHTML = '';
  gameState.participants.filter(p => !p.alive).reverse().forEach(p =>
  {
    const card = document.createElement('div');
    card.className = 'participantCard deadCard';
    const items = p.inventory.map(iId =>
    {
      const item = eventsData.shopItems.find(i => i.id === iId);
      return item ? `<span class="itemTag ${item.tier}">${item.name}</span>` : '';
    }).join('');
    card.innerHTML = `
      <div class="cardName deadName">${p.name}</div>
      <div class="deathCause">${p.causeOfDeath}</div>
      ${p.killedBy ? `<div class="killedBy">Eliminated by ${p.killedBy}</div>` : ''}
      <div class="statRow"><span>💰 $${p.money}</span><span>⚔️ ${p.kills} kills</span></div>
      ${items ? `<div class="itemList">${items}</div>` : ''}
    `;
    el.appendChild(card);
  });
}

function showWinner(winner)
{
  const dead = gameState.participants.filter(p => !p.alive);
  const mostKills = [...gameState.participants].sort((a, b) => b.kills - a.kills)[0];
  const richest = [...gameState.participants].sort((a, b) => b.money - a.money)[0];
  const funniest = dead.length ? randFrom(dead) : null;

  const el = document.getElementById('winnerScreen');
  const inventoryList = winner.inventory.map(iId =>
  {
    const item = eventsData.shopItems.find(i => i.id === iId);
    return item ? `<span class="itemTag ${item.tier}">${item.name}</span>` : '';
  }).join('');

  document.getElementById('winnerName').textContent = winner.name;
  document.getElementById('winnerStats').innerHTML = `
    <div class="winStat">⚔️ Kills: ${winner.kills}</div>
    <div class="winStat">💰 Money: $${winner.money}</div>
    <div class="winStat">❤️ Final HP: ${winner.health}</div>
    ${inventoryList ? `<div class="winInventory">${inventoryList}</div>` : '<div class="winStat">No items.</div>'}
  `;
  document.getElementById('honorRoll').innerHTML = `
    <div class="honorItem"><span class="honorLabel">⚔️ Most Kills</span><span class="honorVal">${mostKills.name} (${mostKills.kills} kills)</span></div>
    <div class="honorItem"><span class="honorLabel">💰 Richest</span><span class="honorVal">${richest.name} ($${richest.money})</span></div>
    ${funniest ? `<div class="honorItem"><span class="honorLabel">🎭 Funniest Death</span><span class="honorVal">${funniest.name}: ${funniest.causeOfDeath}</span></div>` : ''}
  `;

  el.style.display = 'flex';
  setTimeout(() => el.classList.add('visible'), 50);
}

function closeWinner()
{
  const el = document.getElementById('winnerScreen');
  el.classList.remove('visible');
  setTimeout(() =>
  {
    el.style.display = 'none';
  }, 300);

  document.getElementById('nextDayBtn').disabled = true;
  document.getElementById('runEndBtn').disabled = true;

  const logEl = document.getElementById('eventLog');
  logEl.scrollTop = logEl.scrollHeight;
}

function resetGame()
{
  gameState = null;
  document.getElementById('winnerScreen').style.display = 'none';
  document.getElementById('winnerScreen').classList.remove('visible');
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'flex';
  document.getElementById('nextDayBtn').disabled = false;
  document.getElementById('runEndBtn').disabled = false;
}

function showToast(msg)
{
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function toggleTheme()
{
  document.body.classList.toggle('light');
  const btn = document.getElementById('themeToggle');
  btn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
}

document.addEventListener('DOMContentLoaded', async () =>
{
  await loadEvents();
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('nextDayBtn').addEventListener('click', nextDay);
  document.getElementById('runEndBtn').addEventListener('click', runToEnd);
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('winnerResetBtn').addEventListener('click', resetGame);
  document.getElementById('winnerCloseBtn').addEventListener('click', closeWinner);

  document.getElementById('winnerScreen').addEventListener('click', (e) =>
  {
    if (e.target === document.getElementById('winnerScreen'))
    {
      closeWinner();
    }
  });
});