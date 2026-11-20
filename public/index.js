(() => {
  // Elements
  const guestView = document.getElementById('guestView');
  const dashboardView = document.getElementById('dashboardView');
  const toastEl = document.getElementById('toast');

  // User meta
  const userAvatar = document.getElementById('userAvatar');
  const userDisplayName = document.getElementById('userDisplayName');
  const userLogin = document.getElementById('userLogin');
  const logoutBtn = document.getElementById('logoutBtn');

  // Overlay URL
  const overlayUrlInput = document.getElementById('overlayUrlInput');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyUrlText = document.getElementById('copyUrlText');
  const openOverlayLink = document.getElementById('openOverlayLink');
  const regenerateTokenBtn = document.getElementById('regenerateTokenBtn');

  // Settings
  const settingsForm = document.getElementById('settingsForm');
  const badgeTextInput = document.getElementById('badgeTextInput');
  const badgeColorPicker = document.getElementById('badgeColorPicker');
  const badgeBgColorPicker = document.getElementById('badgeBgColorPicker');
  const fontFamilySelect = document.getElementById('fontFamilySelect');
  const fontSizeScaleSelect = document.getElementById('fontSizeScaleSelect');
  const viewerColorPicker = document.getElementById('viewerColorPicker');
  const cardThemeSelect = document.getElementById('cardThemeSelect');
  const cardBgColorPicker = document.getElementById('cardBgColorPicker');
  const cardBgOpacitySelect = document.getElementById('cardBgOpacitySelect');
  const cardBorderColorPicker = document.getElementById('cardBorderColorPicker');
  const cardGlowColorPicker = document.getElementById('cardGlowColorPicker');
  const cardRadiusSelect = document.getElementById('cardRadiusSelect');
  const soundToggle = document.getElementById('soundToggle');
  const whitelistTagsContainer = document.getElementById('whitelistTagsContainer');
  const newTagInput = document.getElementById('newTagInput');
  const addTagBtn = document.getElementById('addTagBtn');

  // Twitch Rewards Quick Pick & Skipped Alert
  const fetchTwitchRewardsBtn = document.getElementById('fetchTwitchRewardsBtn');
  const twitchRewardsList = document.getElementById('twitchRewardsList');
  const skippedAlertBanner = document.getElementById('skippedAlertBanner');
  const skippedAlertText = document.getElementById('skippedAlertText');
  const addSkippedToWhitelistBtn = document.getElementById('addSkippedToWhitelistBtn');
  const dismissSkippedAlertBtn = document.getElementById('dismissSkippedAlertBtn');

  // Preview elements
  const previewCard = document.getElementById('previewCard');
  const previewLiveIndicator = document.getElementById('previewLiveIndicator');
  const previewIndicatorLabel = document.getElementById('previewIndicatorLabel');
  const previewViewer = document.getElementById('previewViewer');
  const previewRewardTitle = document.getElementById('previewRewardTitle');
  const resetOverlayBtn = document.getElementById('resetOverlayBtn');
  const sendTestRedeemBtn = document.getElementById('sendTestRedeemBtn');

  let currentUser = null;
  let currentWhitelist = [];
  let toastTimer = null;
  let lastSkippedRewardTitle = '';
  let dashboardWs = null;
  let cachedTwitchRewards = [];

  const THEME_PRESETS = {
    purple: { bg: '#1c1030', opacity: '0.94', border: '#c4b5fd', glow: '#a855f7', radius: '16px' },
    midnight: { bg: '#0f172a', opacity: '0.95', border: '#38bdf8', glow: '#38bdf8', radius: '16px' },
    cyberpunk: { bg: '#18181b', opacity: '0.95', border: '#f43f5e', glow: '#f43f5e', radius: '8px' },
    emerald: { bg: '#022c22', opacity: '0.94', border: '#34d399', glow: '#10b981', radius: '16px' },
    sunset: { bg: '#271406', opacity: '0.94', border: '#fbbf24', glow: '#f59e0b', radius: '16px' },
    stealth: { bg: '#09090b', opacity: '0.98', border: '#475569', glow: '#64748b', radius: '12px' },
  };

  function hexToRgba(hex, alpha = 1.0) {
    if (!hex) return `rgba(28, 16, 48, ${alpha})`;
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(28, 16, 48, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function showToast(message, duration = 3000) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
    }, duration);
  }

  // Initial load
  async function checkAuth() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        currentWhitelist = data.user.whitelistWords || [];
        renderDashboard();
      } else {
        renderGuest();
      }
    } catch {
      renderGuest();
    }
  }

  function renderGuest() {
    guestView.classList.remove('hidden');
    dashboardView.classList.add('hidden');

    const devLoginBtn = document.getElementById('devLoginBtn');
    if (devLoginBtn && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      devLoginBtn.style.display = 'inline-flex';
    }
  }

  function renderDashboard() {
    guestView.classList.add('hidden');
    dashboardView.classList.remove('hidden');

    userAvatar.src = currentUser.profileImageUrl || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bbbb-6a3f15440b54-profile_image-70x70.png';
    userDisplayName.textContent = currentUser.displayName;
    userLogin.textContent = `@${currentUser.login}`;

    updateOverlayUrl(currentUser.overlayToken);

    badgeTextInput.value = currentUser.badgeText || '👑 1ST REDEEMER';
    badgeColorPicker.value = currentUser.badgeColor || '#fbbf24';
    if (badgeBgColorPicker) badgeBgColorPicker.value = currentUser.badgeBgColor?.startsWith('#') ? currentUser.badgeBgColor : '#451a03';
    if (fontFamilySelect) fontFamilySelect.value = currentUser.fontFamily || 'Kanit';
    if (fontSizeScaleSelect) fontSizeScaleSelect.value = String(currentUser.fontSizeScale || 1.0);
    if (viewerColorPicker) viewerColorPicker.value = currentUser.viewerColor || '#ffffff';
    cardThemeSelect.value = currentUser.cardTheme || 'purple';
    if (cardBgColorPicker) cardBgColorPicker.value = currentUser.cardBgColor || '#1c1030';
    if (cardBgOpacitySelect) cardBgOpacitySelect.value = String(currentUser.cardBgOpacity ?? 0.94);
    if (cardBorderColorPicker) cardBorderColorPicker.value = currentUser.cardBorderColor || '#c4b5fd';
    if (cardGlowColorPicker) cardGlowColorPicker.value = currentUser.cardGlowColor || '#a855f7';
    if (cardRadiusSelect) cardRadiusSelect.value = currentUser.cardRadius || '16px';
    soundToggle.checked = Boolean(currentUser.soundEnabled);

    renderTags();
    updateLivePreview();
    connectDashboardWs();
    fetchTwitchRewards();
  }

  function updateOverlayUrl(token) {
    const url = `${window.location.origin}/overlay.html?token=${token}`;
    overlayUrlInput.value = url;
    openOverlayLink.href = url;
  }

  function renderTags() {
    whitelistTagsContainer.innerHTML = '';
    if (currentWhitelist.length === 0) {
      whitelistTagsContainer.innerHTML = '<span class="hint-text">ยังไม่มีรายการแต้ม (อนุญาตให้แสดงทุกแต้ม)</span>';
      return;
    }

    currentWhitelist.forEach((word, index) => {
      const tag = document.createElement('div');
      tag.className = 'tag-item';

      const text = document.createElement('span');
      text.textContent = word;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-remove-btn';
      removeBtn.setAttribute('aria-label', `ลบแต้ม ${word}`);
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', () => {
        currentWhitelist.splice(index, 1);
        renderTags();
        updateTwitchRewardChips();
        updateLivePreview();
      });

      tag.appendChild(text);
      tag.appendChild(removeBtn);
      whitelistTagsContainer.appendChild(tag);
    });
  }

  function addTag() {
    const word = newTagInput.value.trim();
    if (!word) return;
    if (!currentWhitelist.includes(word)) {
      currentWhitelist.push(word);
      renderTags();
      updateTwitchRewardChips();
      updateLivePreview();
    }
    newTagInput.value = '';
  }

  addTagBtn.addEventListener('click', addTag);
  newTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });

  // Color chips
  document.querySelectorAll('.color-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      badgeColorPicker.value = color;
      updateLivePreview();
    });
  });

  document.querySelectorAll('.color-bg-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const bgcolor = chip.getAttribute('data-bgcolor');
      if (badgeBgColorPicker) {
        badgeBgColorPicker.dataset.chosenBg = bgcolor;
      }
      updateLivePreview();
    });
  });

  document.querySelectorAll('.viewer-color-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (viewerColorPicker) viewerColorPicker.value = color;
      updateLivePreview();
    });
  });

  // Card theme chips
  document.querySelectorAll('.card-bg-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (cardBgColorPicker) cardBgColorPicker.value = color;
      if (cardThemeSelect) cardThemeSelect.value = 'custom';
      updateLivePreview();
    });
  });

  document.querySelectorAll('.card-border-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (cardBorderColorPicker) cardBorderColorPicker.value = color;
      if (cardThemeSelect) cardThemeSelect.value = 'custom';
      updateLivePreview();
    });
  });

  document.querySelectorAll('.card-glow-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (cardGlowColorPicker) cardGlowColorPicker.value = color;
      if (cardThemeSelect) cardThemeSelect.value = 'custom';
      updateLivePreview();
    });
  });

  // Theme preset change
  cardThemeSelect.addEventListener('change', () => {
    const selectedTheme = cardThemeSelect.value;
    const preset = THEME_PRESETS[selectedTheme];
    if (preset) {
      if (cardBgColorPicker) cardBgColorPicker.value = preset.bg;
      if (cardBgOpacitySelect) cardBgOpacitySelect.value = preset.opacity;
      if (cardBorderColorPicker) cardBorderColorPicker.value = preset.border;
      if (cardGlowColorPicker) cardGlowColorPicker.value = preset.glow;
      if (cardRadiusSelect) cardRadiusSelect.value = preset.radius;
    }
    updateLivePreview();
  });

  // Custom theme controls change -> switch theme to 'custom'
  function onCustomCardStyleChange() {
    if (cardThemeSelect.value !== 'custom') {
      cardThemeSelect.value = 'custom';
    }
    updateLivePreview();
  }

  if (cardBgColorPicker) cardBgColorPicker.addEventListener('input', onCustomCardStyleChange);
  if (cardBgOpacitySelect) cardBgOpacitySelect.addEventListener('change', onCustomCardStyleChange);
  if (cardBorderColorPicker) cardBorderColorPicker.addEventListener('input', onCustomCardStyleChange);
  if (cardGlowColorPicker) cardGlowColorPicker.addEventListener('input', onCustomCardStyleChange);
  if (cardRadiusSelect) cardRadiusSelect.addEventListener('change', onCustomCardStyleChange);

  // Real-time preview updates
  badgeTextInput.addEventListener('input', updateLivePreview);
  badgeColorPicker.addEventListener('input', updateLivePreview);
  if (badgeBgColorPicker) badgeBgColorPicker.addEventListener('input', updateLivePreview);
  if (fontFamilySelect) fontFamilySelect.addEventListener('change', updateLivePreview);
  if (fontSizeScaleSelect) fontSizeScaleSelect.addEventListener('change', updateLivePreview);
  if (viewerColorPicker) viewerColorPicker.addEventListener('input', updateLivePreview);

  function updateLivePreview() {
    const badgeText = badgeTextInput.value.trim() || '👑 1ST REDEEMER';
    const badgeColor = badgeColorPicker.value || '#fbbf24';
    const badgeBg = badgeBgColorPicker?.dataset?.chosenBg || badgeBgColorPicker?.value || 'rgba(245, 158, 11, 0.22)';
    const fontFamily = fontFamilySelect?.value || 'Kanit';
    const fontScale = fontSizeScaleSelect?.value || '1.0';
    const viewerColor = viewerColorPicker?.value || '#ffffff';
    const theme = cardThemeSelect.value || 'purple';

    const bgColor = cardBgColorPicker?.value || '#1c1030';
    const bgOpacity = parseFloat(cardBgOpacitySelect?.value || '0.94');
    const borderColor = cardBorderColorPicker?.value || '#c4b5fd';
    const glowColor = cardGlowColorPicker?.value || '#a855f7';
    const radius = cardRadiusSelect?.value || '16px';

    const bgRgba = hexToRgba(bgColor, bgOpacity);
    const bgRgbaDark = hexToRgba(bgColor, Math.min(1.0, bgOpacity + 0.04));
    const borderRgba = hexToRgba(borderColor, 0.35);
    const glowBoxRgba = hexToRgba(glowColor, 0.28);
    const glowAmbientRgba = hexToRgba(glowColor, 0.35);

    if (previewIndicatorLabel) {
      previewIndicatorLabel.textContent = badgeText;
      previewIndicatorLabel.style.color = badgeColor;
    }
    if (previewLiveIndicator) {
      previewLiveIndicator.style.borderColor = badgeColor;
      previewLiveIndicator.style.background = badgeBg;
    }

    if (previewViewer) previewViewer.style.color = viewerColor;

    previewCard.style.setProperty('--overlay-font', fontFamily);
    previewCard.style.setProperty('--overlay-scale', fontScale);
    previewCard.style.setProperty('--badge-color', badgeColor);
    previewCard.style.setProperty('--badge-bg', badgeBg);
    previewCard.style.setProperty('--badge-glow', `${badgeColor}66`);
    previewCard.style.setProperty('--viewer-color', viewerColor);

    // Custom card theme variables
    previewCard.style.setProperty('--card-bg', `linear-gradient(135deg, ${bgRgba} 0%, ${bgRgbaDark} 100%)`);
    previewCard.style.setProperty('--card-border', borderRgba);
    previewCard.style.setProperty('--card-glow', glowBoxRgba);
    previewCard.style.setProperty('--card-glow-ambient', glowAmbientRgba);
    previewCard.style.setProperty('--card-radius', radius);

    previewCard.className = `redeem-card theme-${theme} first-redeemer`;

    if (currentWhitelist.length > 0) {
      previewRewardTitle.textContent = currentWhitelist[0];
    } else {
      previewRewardTitle.textContent = 'แต้มตัวอย่าง (Channel Point)';
    }
  }

  // Copy Overlay URL
  copyUrlBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(overlayUrlInput.value);
      copyUrlText.textContent = 'Copied!';
      showToast('คัดลอก Overlay URL เรียบร้อยแล้ว!');
      setTimeout(() => {
        copyUrlText.textContent = 'Copy URL';
      }, 2000);
    } catch {
      prompt('Copy your OBS Overlay URL:', overlayUrlInput.value);
    }
  });

  // Regenerate Token
  regenerateTokenBtn.addEventListener('click', async () => {
    if (!confirm('ยืนยันสร้าง Overlay Token ใหม่? (คุณจะต้องนำลิงก์ใหม่ไปเปลี่ยนใน OBS Studio ด้วย)')) return;

    try {
      const res = await fetch('/api/regenerate-token', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        currentUser.overlayToken = data.overlayToken;
        updateOverlayUrl(data.overlayToken);
        showToast('สร้าง Token ใหม่สำเร็จ! อย่าลืมอัปเดตใน OBS');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Save Settings
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      badgeText: badgeTextInput.value.trim(),
      badgeColor: badgeColorPicker.value,
      badgeBgColor: badgeBgColorPicker?.dataset?.chosenBg || badgeBgColorPicker?.value || 'rgba(245, 158, 11, 0.22)',
      fontFamily: fontFamilySelect?.value || 'Kanit',
      fontSizeScale: parseFloat(fontSizeScaleSelect?.value || '1.0'),
      viewerColor: viewerColorPicker?.value || '#ffffff',
      cardTheme: cardThemeSelect.value,
      cardBgColor: cardBgColorPicker?.value || '#1c1030',
      cardBgOpacity: parseFloat(cardBgOpacitySelect?.value || '0.94'),
      cardBorderColor: cardBorderColorPicker?.value || '#c4b5fd',
      cardGlowColor: cardGlowColorPicker?.value || '#a855f7',
      cardRadius: cardRadiusSelect?.value || '16px',
      soundEnabled: soundToggle.checked,
      whitelistWords: currentWhitelist,
    };

    try {
      showToast('กำลังบันทึกการตั้งค่า...');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        showToast('บันทึกการตั้งค่าสำเร็จ! หน้าจอ OBS จะอัปเดตทันที');
      } else {
        showToast(`บันทึกไม่สำเร็จ: ${data.error}`);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Test Redemption
  sendTestRedeemBtn.addEventListener('click', async () => {
    try {
      showToast('กำลังส่งทดสอบแต้ม...');
      const sampleReward = currentWhitelist.length > 0 ? currentWhitelist[0] : 'แต้มแรกของวัน';
      const res = await fetch('/api/test-redemption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: 'สมชายสายเปย์',
          displayName: 'สมชายสายเปย์',
          rewardTitle: sampleReward,
        }),
      });

      const data = await res.json();
      if (data.success) {
        previewViewer.textContent = data.redemption.displayName;
        previewRewardTitle.textContent = data.redemption.rewardTitle;
        showToast(`ส่งทดสอบสำเร็จ: ${data.redemption.displayName} (${data.redemption.rewardTitle})`);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Reset Overlay
  resetOverlayBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/reset-overlay', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        previewViewer.textContent = 'ViewerName';
        previewRewardTitle.textContent = currentWhitelist[0] || 'Reward Title';
        showToast('ล้างหน้าจอ Overlay สำเร็จ');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // --- Twitch Custom Rewards & Skipped Alert Logic ---
  function showSkippedAlert(data) {
    if (!skippedAlertBanner || !skippedAlertText) return;
    lastSkippedRewardTitle = data.rewardTitle;
    skippedAlertText.textContent = `ผู้ชม @${data.displayName || 'ผู้ชม'} แลกแต้ม "${data.rewardTitle}" แต่ถูกข้ามเนื่องจากไม่อยู่ใน Whitelist`;
    skippedAlertBanner.classList.remove('hidden');
    showToast(`⚠️ มีแต้มถูกข้าม: "${data.rewardTitle}" (ไม่อยู่ใน Whitelist)`);
  }

  if (dismissSkippedAlertBtn) {
    dismissSkippedAlertBtn.addEventListener('click', () => {
      skippedAlertBanner.classList.add('hidden');
    });
  }

  if (addSkippedToWhitelistBtn) {
    addSkippedToWhitelistBtn.addEventListener('click', () => {
      if (lastSkippedRewardTitle && !currentWhitelist.includes(lastSkippedRewardTitle)) {
        currentWhitelist.push(lastSkippedRewardTitle);
        renderTags();
        updateTwitchRewardChips();
        updateLivePreview();
        skippedAlertBanner.classList.add('hidden');
        showToast(`เพิ่ม "${lastSkippedRewardTitle}" ลง Whitelist แล้ว! อย่าลืมกดบันทึกการตั้งค่า`);
      }
    });
  }

  async function fetchTwitchRewards() {
    if (!twitchRewardsList) return;
    twitchRewardsList.innerHTML = '<span class="hint-text-muted">กำลังโหลดแต้มจาก Twitch...</span>';

    try {
      const res = await fetch('/api/twitch/custom-rewards');
      const data = await res.json();

      if (!data.success) {
        twitchRewardsList.innerHTML = `<span class="hint-text-error">โหลดแต้มไม่สำเร็จ: ${data.error || 'Unknown error'}</span>`;
        return;
      }

      if (!data.isAffiliate) {
        twitchRewardsList.innerHTML = `<span class="hint-text">${data.message || 'ช่องนี้ยังไม่ได้เปิดระบบ Channel Points'}</span>`;
        return;
      }

      cachedTwitchRewards = data.rewards || [];
      if (cachedTwitchRewards.length === 0) {
        twitchRewardsList.innerHTML = '<span class="hint-text">ไม่พบรายการแต้มในช่องของคุณ</span>';
        return;
      }

      renderTwitchRewardsList();
    } catch (err) {
      twitchRewardsList.innerHTML = `<span class="hint-text-error">Error: ${err.message}</span>`;
    }
  }

  function renderTwitchRewardsList() {
    if (!twitchRewardsList) return;
    twitchRewardsList.innerHTML = '';

    cachedTwitchRewards.forEach((r) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isSelected = currentWhitelist.includes(r.title);
      chip.className = `twitch-reward-chip ${isSelected ? 'active' : ''}`;
      chip.setAttribute('data-reward-title', r.title);

      const titleSpan = document.createElement('span');
      titleSpan.textContent = `${isSelected ? '✓ ' : '+ '}${r.title}`;

      const costSpan = document.createElement('span');
      costSpan.className = 'chip-cost';
      costSpan.textContent = `(${r.cost.toLocaleString()} pts)`;

      chip.appendChild(titleSpan);
      chip.appendChild(costSpan);

      chip.addEventListener('click', () => {
        const title = r.title;
        const idx = currentWhitelist.indexOf(title);
        if (idx >= 0) {
          currentWhitelist.splice(idx, 1);
        } else {
          currentWhitelist.push(title);
        }
        renderTags();
        updateTwitchRewardChips();
        updateLivePreview();
      });

      twitchRewardsList.appendChild(chip);
    });
  }

  function updateTwitchRewardChips() {
    if (!twitchRewardsList) return;
    const chips = twitchRewardsList.querySelectorAll('.twitch-reward-chip');
    chips.forEach((chip) => {
      const title = chip.getAttribute('data-reward-title');
      const isSelected = currentWhitelist.includes(title);
      if (isSelected) {
        chip.classList.add('active');
        const firstSpan = chip.querySelector('span:first-child');
        if (firstSpan) firstSpan.textContent = `✓ ${title}`;
      } else {
        chip.classList.remove('active');
        const firstSpan = chip.querySelector('span:first-child');
        if (firstSpan) firstSpan.textContent = `+ ${title}`;
      }
    });
  }

  if (fetchTwitchRewardsBtn) {
    fetchTwitchRewardsBtn.addEventListener('click', fetchTwitchRewards);
  }

  function connectDashboardWs() {
    if (dashboardWs) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    dashboardWs = new WebSocket(`${protocol}//${window.location.host}/ws`);

    dashboardWs.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'SKIPPED_REDEMPTION') {
          showSkippedAlert(payload.data);
        } else if (payload.type === 'REDEMPTION') {
          previewViewer.textContent = payload.data.displayName;
          previewRewardTitle.textContent = payload.data.rewardTitle;
          showToast(`🎉 มีการแลกแต้มสด: ${payload.data.displayName} (${payload.data.rewardTitle})`);
        }
      } catch {}
    };

    dashboardWs.onclose = () => {
      dashboardWs = null;
      setTimeout(connectDashboardWs, 5000);
    };
  }

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });

  // Start
  checkAuth();
})();

