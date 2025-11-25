import { races, progression, items, gddConstants, bestiary, gems } from './gdd.js';

const Systems = {
  calculateDerivedStats(player) {
    player.derivedStats = {};
    const racialData = races[player.race]; // [FIX] This now works because player.race is the lowercase ID
    if (!racialData) throw new Error(`Invalid race specified: ${player.race}`);
    let totalGearAC = 0;
    let totalGearWC = 0;
    let totalGearSC = 0;
    let bonusHitChance = 0;
    let bonusWcScMultiplier = 1.0;
    for (const slotName in player.equipment) {
      const instanceId = player.equipment[slotName];
      if (!instanceId) continue;
      const item = player.inventory.find(i => i.instanceId === instanceId);
      const baseItem = items.baseItemTemplates.find(b => b.id === item.baseItemId);
      if (!item || !baseItem) continue;
      const slotData = progression.dropperSlotModifiers[baseItem.subType] || {};
      const tierData = progression.dropperTiers.find(t => t.tier === item.tier);
      if (!tierData) continue;
      const itemStatValue = tierData.classValue * (slotData.statProportionality || 0);
      if (slotData.statType === 'AC') totalGearAC += itemStatValue;
      if (slotData.statType === 'WC') totalGearWC += itemStatValue;
      if (slotData.statType === 'SC') totalGearSC += itemStatValue;
      if (slotData.specialBonus) {
        if (slotData.specialBonus.stat === 'Hit Chance') bonusHitChance += slotData.specialBonus.value;
        if (slotData.specialBonus.stat === 'WC/SC') bonusWcScMultiplier += slotData.specialBonus.value;
      }
    }
    let finalWC = 0, finalSC = 0;
    let scalingStatValue = 0;
    const primaryStat = racialData.primaryStat;
    scalingStatValue = player.baseStats[primaryStat] || 0;
    switch (racialData.archetype) {
      case 'True Fighter':
        if(racialData.specialCase === "Damage scales with VIT instead of DEX.") {
          finalWC = totalGearWC * (1 + ((player.baseStats.VIT || 0) * 0.0055));
        } else {
          finalWC = totalGearWC * (1 + (scalingStatValue * 0.0055));
        }
        break;
      case 'True Caster':
        if(racialData.specialCase === "Damage scales with VIT instead of WIS.") {
          finalSC = totalGearSC * (1 + ((player.baseStats.VIT || 0) * 0.0055));
        } else {
          finalSC = totalGearSC * (1 + (scalingStatValue * 0.0055));
        }
        break;
      case 'Hybrid':
        finalWC = totalGearWC * (1 + (scalingStatValue * 0.0055));
        finalSC = totalGearSC * (1 + (scalingStatValue * 0.0055));
        break;
    }
    finalWC *= bonusWcScMultiplier;
    finalSC *= bonusWcScMultiplier;
    player.derivedStats.maxHp = 100 + ((player.baseStats.VIT || 0) * 10);
    player.derivedStats.AC = totalGearAC * (1 + ((player.baseStats.VIT || 0) * 0.0075));
    player.derivedStats.WC = finalWC;
    player.derivedStats.SC = finalSC;
    if (primaryStat === 'DEX' || (racialData.archetype === 'True Fighter' && primaryStat === 'VIT')) {
      player.derivedStats.hitChance = 90 + ((player.baseStats.DEX || 0) * 0.05);
      player.derivedStats.critChance = 5 + ((player.baseStats.DEX || 0) * 0.01);
    } else {
      player.derivedStats.hitChance = 90 + ((player.baseStats.WIS || 0) * 0.05);
      player.derivedStats.critChance = 5 + ((player.baseStats.WIS || 0) * 0.01);
    }
    player.derivedStats.hitChance += (player.derivedStats.hitChance * bonusHitChance);
    if (player.hp === undefined || player.hp > player.derivedStats.maxHp) player.hp = player.derivedStats.maxHp;
    player.stats = player.derivedStats;
    return player;
  },
  MonsterScaling(monster, targetGearTier) {
    const baseMonster = { ...monster };
    if (targetGearTier <= 1) return baseMonster;
    const tierDiff = targetGearTier - 1;
    baseMonster.hp = baseMonster.hp * Math.pow(gddConstants.MONSTER_SCALING_HP_RATE, tierDiff);
    baseMonster.atk = baseMonster.atk * Math.pow(gddConstants.MONSTER_SCALING_ATK_RATE, tierDiff);
    baseMonster.def = baseMonster.def * Math.pow(gddConstants.MONSTER_SCALING_DEF_RATE, tierDiff);
    baseMonster.xp = baseMonster.xp * Math.pow(gddConstants.MONSTER_SCALING_REWARD_RATE, tierDiff);
    baseMonster.gold = baseMonster.gold * Math.pow(gddConstants.MONSTER_SCALING_REWARD_RATE, tierDiff);
    return baseMonster;
  },
  resolveCombatTurn(player, monster) {
    const racialData = races[player.race]; // [FIX] Removed .toLowerCase()
    if (!racialData) throw new Error(`Invalid race specified: ${player.race}`);
    let playerDamage = 0;
    const playerStats = player.derivedStats;
    const monsterStats = monster;
    const monsterAC = monsterStats.def;
    if (racialData.archetype === 'Hybrid') {
      const wcDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.WC) / monsterAC;
      const scDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.SC) / monsterAC;
      playerDamage = (wcDamage + scDamage) * gddConstants.HYBRID_SPELLSTRIKE_MULTIPLIER;
    } else if (racialData.archetype === 'True Fighter') {
      playerDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.WC) / monsterAC;
    } else if (racialData.archetype === 'True Caster') {
      playerDamage = (gddConstants.PLAYER_DAMAGE_CONSTANT * playerStats.SC) / monsterAC;
    }
    monster.currentHP -= playerDamage;
    if (monster.currentHP <= 0) {
      monster.currentHP = 0;
      return { status: 'VICTORY', player, monster, damageDealt: playerDamage };
    }
    let monsterDamage = monsterStats.atk - (playerStats.AC * gddConstants.MONSTER_DAMAGE_AC_REDUCTION_FACTOR);
    monsterDamage = Math.max(0, monsterDamage);
    player.hp -= monsterDamage;
    if (player.hp <= 0) {
      player.hp = 0;
      return { status: 'DEFEAT', player, monster, damageTaken: monsterDamage };
    }
    return { status: 'CONTINUE', player, monster, damageDealt: playerDamage, damageTaken: monsterDamage };
  },
  simulateCombat(player, monster) {
    let simPlayer = JSON.parse(JSON.stringify(player));
    let simMonster = JSON.parse(JSON.stringify(monster));
    simMonster.currentHP = simMonster.hp;
    const combatLog = [`Combat Start: ${simPlayer.name} vs. ${simMonster.name}`];
    let turn = 1;
    let result = {};
    while (true) {
      result = Systems.resolveCombatTurn(simPlayer, simMonster);
      combatLog.push(`Turn ${turn}: ${simPlayer.name} deals ${result.damageDealt.toFixed(2)} damage. [Monster HP: ${simMonster.currentHP.toFixed(2)}]`);
      if (result.status === 'VICTORY') {
        combatLog.push(`${simMonster.name} has been defeated!`);
        break;
      }
      combatLog.push(`Turn ${turn}: ${simMonster.name} deals ${result.damageTaken.toFixed(2)} damage. [Player HP: ${simPlayer.hp.toFixed(2)}]`);
      if (result.status === 'DEFEAT') {
        combatLog.push(`${simPlayer.name} has been defeated!`);
        break;
      }
      turn++;
      if (turn > 100) {
        combatLog.push('Combat exceeded 100 turns. Halting simulation.');
        result.status = 'STALEMATE';
        break;
      }
    }
    return {
      outcome: result.status,
      finalState: { player: simPlayer, monster: simMonster },
      log: combatLog
    };
  },
  generateLoot(player, monster, currentZoneId) {
    const lootMessages = [];
    player.gold += monster.gold;
    player.xp += monster.xp;
    lootMessages.push(`You earned <span class="log-xp">${Math.floor(monster.xp)} XP</span> and <span class="log-gold">${Math.floor(monster.gold)} Gold</span>!`);
    if (Math.random() < gddConstants.BASE_GEM_DROP_CHANCE) {
        const zoneData = bestiary[currentZoneId];
        const gemGradeTier = progression.gemGradeTiers.find(g => g.correspondingZone.includes(zoneData.zoneId))?.gradeTier || 1;
        const allStandardGems = Object.values(gems.standard);
        const randomGem = allStandardGems[Math.floor(Math.random() * allStandardGems.length)];
        const newGem = { id: randomGem.id, grade: gemGradeTier };
        player.gems.push(newGem);
        lootMessages.push(`You found a new gem: <span class="log-loot-gem">${randomGem.name} (Grade ${newGem.grade})</span>!`);
    }
    if (Math.random() < gddConstants.BASE_SHADOW_DROP_CHANCE) {
        const equippedDroppers = Object.values(player.equipment).filter(itemId => {
            const item = player.inventory.find(i => i.instanceId === itemId);
            return item && item.type === 'Dropper';
        });
        if (equippedDroppers.length > 0) {
            const randomEquippedItemInstanceId = equippedDroppers[Math.floor(Math.random() * equippedDroppers.length)];
            const randomEquippedItem = player.inventory.find(i => i.instanceId === randomEquippedItemInstanceId);
            const existingShadow = Object.values(player.equipment).find(itemId => {
                const item = player.inventory.find(i => i.instanceId === itemId);
                return item && item.baseItemId === randomEquippedItem.baseItemId && item.type === 'Shadow';
            });
            let newItem;
            if (existingShadow) {
                newItem = { ...randomEquippedItem, instanceId: `${randomEquippedItem.baseItemId}_${Date.now()}_${Math.random()}`, type: 'Echo', qualityMultiplier: gddConstants.ECHO_QM, enchantments: [] };
                lootMessages.push(`A faint <span class="log-loot-item">Echo</span> of your ${items.baseItemTemplates.find(b => b.id === newItem.baseItemId).name} appears!`);
            } else {
                const randomQM = gddConstants.SHADOW_QM_MIN + (Math.random() * (gddConstants.SHADOW_QM_MAX - gddConstants.SHADOW_QM_MIN));
                newItem = { ...randomEquippedItem, instanceId: `${randomEquippedItem.baseItemId}_${Date.now()}_${Math.random()}`, type: 'Shadow', qualityMultiplier: randomQM, enchantments: [] };
                lootMessages.push(`The shadow of your <span class="log-loot-item">${items.baseItemTemplates.find(b => b.id === newItem.baseItemId).name}</span> solidifies! (QM: ${newItem.qualityMultiplier.toFixed(2)})`);
            }
            player.inventory.push(newItem);
        }
    }
    return lootMessages;
  }
};

export { Systems };