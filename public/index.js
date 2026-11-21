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
  const atColorPicker = document.getElementById('atColorPicker');
  const viewerColorPicker = document.getElementById('viewerColorPicker');
  const hashColorPicker = document.getElementById('hashColorPicker');
  const rewardColorPicker = document.getElementById('rewardColorPicker');
  const fontFamilySelect = document.getElementById('fontFamilySelect');
  const fontSizeScaleSelect = document.getElementById('fontSizeScaleSelect');
  const cardThemeSelect = document.getElementById('cardThemeSelect');
  const cardBgColorPicker = document.getElementById('cardBgColorPicker');
  const cardBgOpacitySelect = document.getElementById('cardBgOpacitySelect');
  const borderToggle = document.getElementById('borderToggle');
  const cardBorderColorPicker = document.getElementById('cardBorderColorPicker');
  const bloomToggle = document.getElementById('bloomToggle');
  const cardGlowColorPicker = document.getElementById('cardGlowColorPicker');
  const shadowToggle = document.getElementById('shadowToggle');
  const cardShadowColorPicker = document.getElementById('cardShadowColorPicker');
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
  const previewPrefixAt = document.getElementById('previewPrefixAt');
  const previewViewer = document.getElementById('previewViewer');
  const previewPrefixHash = document.getElementById('previewPrefixHash');
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
    purple: { bg: '#1c1030', opacity: '0.94', border: '#c4b5fd', glow: '#a855f7', shadow: '#000000', radius: '16px' },
    midnight: { bg: '#0f172a', opacity: '0.95', border: '#38bdf8', glow: '#38bdf8', shadow: '#0f172a', radius: '16px' },
    cyberpunk: { bg: '#18181b', opacity: '0.95', border: '#f43f5e', glow: '#f43f5e', shadow: '#000000', radius: '8px' },
    emerald: { bg: '#022c22', opacity: '0.94', border: '#34d399', glow: '#10b981', shadow: '#022c22', radius: '16px' },
    sunset: { bg: '#271406', opacity: '0.94', border: '#fbbf24', glow: '#f59e0b', shadow: '#271406', radius: '16px' },
    stealth: { bg: '#09090b', opacity: '0.98', border: '#475569', glow: '#64748b', shadow: '#000000', radius: '12px' },
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

    if (badgeTextInput) badgeTextInput.value = currentUser.badgeText || '👑 1ST REDEEMER';
    if (atColorPicker) atColorPicker.value = currentUser.atColor || currentUser.badgeColor || '#fbbf24';
    if (viewerColorPicker) viewerColorPicker.value = currentUser.viewerColor || '#ffffff';
    if (hashColorPicker) hashColorPicker.value = currentUser.hashColor || currentUser.cardBorderColor || '#c4b5fd';
    if (rewardColorPicker) rewardColorPicker.value = currentUser.rewardColor || '#ffffff';
    if (fontFamilySelect) fontFamilySelect.value = currentUser.fontFamily || 'Kanit';
    if (fontSizeScaleSelect) fontSizeScaleSelect.value = String(currentUser.fontSizeScale || 1.0);
    if (cardThemeSelect) cardThemeSelect.value = currentUser.cardTheme || 'purple';
    if (cardBgColorPicker) cardBgColorPicker.value = currentUser.cardBgColor || '#1c1030';
    if (cardBgOpacitySelect) cardBgOpacitySelect.value = String(currentUser.cardBgOpacity ?? 0.94);

    const isBorderOn = currentUser.borderEnabled !== false && currentUser.cardBorderColor !== 'transparent';
    if (borderToggle) borderToggle.checked = isBorderOn;
    if (cardBorderColorPicker) cardBorderColorPicker.value = (currentUser.cardBorderColor && currentUser.cardBorderColor !== 'transparent') ? currentUser.cardBorderColor : '#c4b5fd';

    const isBloomOn = currentUser.bloomEnabled !== false && currentUser.cardGlowColor !== 'transparent';
    if (bloomToggle) bloomToggle.checked = isBloomOn;
    if (cardGlowColorPicker) cardGlowColorPicker.value = (currentUser.cardGlowColor && currentUser.cardGlowColor !== 'transparent') ? currentUser.cardGlowColor : '#a855f7';

    const isShadowOn = currentUser.shadowEnabled !== false && currentUser.cardShadowColor !== 'transparent';
    if (shadowToggle) shadowToggle.checked = isShadowOn;
    if (cardShadowColorPicker) cardShadowColorPicker.value = (currentUser.cardShadowColor && currentUser.cardShadowColor !== 'transparent') ? currentUser.cardShadowColor : '#000000';

    if (cardRadiusSelect) cardRadiusSelect.value = currentUser.cardRadius || '16px';
    if (soundToggle) soundToggle.checked = Boolean(currentUser.soundEnabled);

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

  // Color chips for @, viewer, #, and reward
  document.querySelectorAll('.at-color-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (atColorPicker) atColorPicker.value = color;
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

  document.querySelectorAll('.hash-color-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (hashColorPicker) hashColorPicker.value = color;
      updateLivePreview();
    });
  });

  document.querySelectorAll('.reward-color-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (rewardColorPicker) rewardColorPicker.value = color;
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
      if (color === 'transparent') {
        if (borderToggle) borderToggle.checked = false;
      } else {
        if (borderToggle) borderToggle.checked = true;
        if (cardBorderColorPicker) cardBorderColorPicker.value = color;
      }
      if (cardThemeSelect) cardThemeSelect.value = 'custom';
      updateLivePreview();
    });
  });

  document.querySelectorAll('.card-glow-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (color === 'transparent') {
        if (bloomToggle) bloomToggle.checked = false;
      } else {
        if (bloomToggle) bloomToggle.checked = true;
        if (cardGlowColorPicker) cardGlowColorPicker.value = color;
      }
      if (cardThemeSelect) cardThemeSelect.value = 'custom';
      updateLivePreview();
    });
  });

  document.querySelectorAll('.card-shadow-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      if (color === 'transparent') {
        if (shadowToggle) shadowToggle.checked = false;
      } else {
        if (shadowToggle) shadowToggle.checked = true;
        if (cardShadowColorPicker) cardShadowColorPicker.value = color;
      }
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
      if (borderToggle) borderToggle.checked = true;
      if (cardBorderColorPicker) cardBorderColorPicker.value = preset.border;
      if (bloomToggle) bloomToggle.checked = true;
      if (cardGlowColorPicker) cardGlowColorPicker.value = preset.glow;
      if (shadowToggle) shadowToggle.checked = true;
      if (cardShadowColorPicker) cardShadowColorPicker.value = preset.shadow || '#000000';
      if (cardRadiusSelect) cardRadiusSelect.value = preset.radius;
    }
    updateLivePreview();
  });

  // Custom theme controls change -> switch theme to 'custom'
  function onCustomCardStyleChange() {
    if (cardThemeSelect && cardThemeSelect.value !== 'custom') {
      cardThemeSelect.value = 'custom';
    }
    updateLivePreview();
  }

  if (cardBgColorPicker) cardBgColorPicker.addEventListener('input', onCustomCardStyleChange);
  if (cardBgOpacitySelect) cardBgOpacitySelect.addEventListener('change', onCustomCardStyleChange);
  if (borderToggle) borderToggle.addEventListener('change', onCustomCardStyleChange);
  if (cardBorderColorPicker) {
    cardBorderColorPicker.addEventListener('input', () => {
      if (borderToggle) borderToggle.checked = true;
      onCustomCardStyleChange();
    });
  }
  if (bloomToggle) bloomToggle.addEventListener('change', onCustomCardStyleChange);
  if (cardGlowColorPicker) {
    cardGlowColorPicker.addEventListener('input', () => {
      if (bloomToggle) bloomToggle.checked = true;
      onCustomCardStyleChange();
    });
  }
  if (shadowToggle) shadowToggle.addEventListener('change', onCustomCardStyleChange);
  if (cardShadowColorPicker) {
    cardShadowColorPicker.addEventListener('input', () => {
      if (shadowToggle) shadowToggle.checked = true;
      onCustomCardStyleChange();
    });
  }
  if (cardRadiusSelect) cardRadiusSelect.addEventListener('change', onCustomCardStyleChange);

  // Real-time preview updates for text and colors
  if (atColorPicker) atColorPicker.addEventListener('input', updateLivePreview);
  if (viewerColorPicker) viewerColorPicker.addEventListener('input', updateLivePreview);
  if (hashColorPicker) hashColorPicker.addEventListener('input', updateLivePreview);
  if (rewardColorPicker) rewardColorPicker.addEventListener('input', updateLivePreview);
  if (fontFamilySelect) fontFamilySelect.addEventListener('change', updateLivePreview);
  if (fontSizeScaleSelect) fontSizeScaleSelect.addEventListener('change', updateLivePreview);

  function updateLivePreview() {
    const atColor = atColorPicker?.value || '#fbbf24';
    const viewerColor = viewerColorPicker?.value || '#ffffff';
    const hashColor = hashColorPicker?.value || '#c4b5fd';
    const rewardColor = rewardColorPicker?.value || '#ffffff';
    const fontFamily = fontFamilySelect?.value || 'Kanit';
    const fontScale = fontSizeScaleSelect?.value || '1.0';
    const theme = cardThemeSelect?.value || 'purple';

    const bgColor = cardBgColorPicker?.value || '#1c1030';
    const bgOpacity = parseFloat(cardBgOpacitySelect?.value ?? '0.94');
    const isBorderEnabled = Boolean(borderToggle?.checked);
    const borderColor = isBorderEnabled ? (cardBorderColorPicker?.value || '#c4b5fd') : 'transparent';
    const isBloomEnabled = Boolean(bloomToggle?.checked);
    const glowColor = isBloomEnabled ? (cardGlowColorPicker?.value || '#a855f7') : 'transparent';
    const isShadowEnabled = Boolean(shadowToggle?.checked);
    const shadowColor = isShadowEnabled ? (cardShadowColorPicker?.value || '#000000') : 'transparent';
    const radius = cardRadiusSelect?.value || '16px';

    previewCard.style.setProperty('--overlay-font', fontFamily);
    previewCard.style.setProperty('--overlay-scale', fontScale);
    previewCard.style.setProperty('--badge-color', atColor);
    previewCard.style.setProperty('--at-color', atColor);
    previewCard.style.setProperty('--at-glow', `${atColor}66`);
    previewCard.style.setProperty('--viewer-color', viewerColor);
    previewCard.style.setProperty('--hash-color', hashColor);
    previewCard.style.setProperty('--hash-glow', `${hashColor}66`);
    previewCard.style.setProperty('--reward-color', rewardColor);

    // Card background (handle transparent 0%)
    if (bgOpacity === 0) {
      previewCard.style.setProperty('--card-bg', 'transparent');
      previewCard.classList.add('transparent-bg');
    } else {
      previewCard.classList.remove('transparent-bg');
      const bgRgba = hexToRgba(bgColor, bgOpacity);
      const bgRgbaDark = hexToRgba(bgColor, Math.min(1.0, bgOpacity + 0.04));
      previewCard.style.setProperty('--card-bg', `linear-gradient(135deg, ${bgRgba} 0%, ${bgRgbaDark} 100%)`);
    }

    previewCard.style.setProperty('--card-radius', radius);

    // Border handling
    if (isBorderEnabled && borderColor !== 'transparent') {
      previewCard.classList.remove('no-border');
      const borderRgba = hexToRgba(borderColor, 0.35);
      previewCard.style.setProperty('--card-border', borderRgba);
    } else {
      previewCard.classList.add('no-border');
      previewCard.style.setProperty('--card-border', 'transparent');
    }

    // Shadow handling
    if (isShadowEnabled && shadowColor !== 'transparent') {
      previewCard.classList.remove('no-shadow');
      const shadowRgba = hexToRgba(shadowColor, 0.6);
      previewCard.style.setProperty('--card-shadow', `0 10px 30px -5px ${shadowRgba}`);
      previewCard.style.setProperty('--card-inset', 'inset 0 1px 0 rgba(255, 255, 255, 0.15)');
    } else {
      previewCard.classList.add('no-shadow');
      previewCard.style.setProperty('--card-shadow', 'none');
      previewCard.style.setProperty('--card-inset', 'none');
    }

    // Bloom / Glow handling
    if (isBloomEnabled && glowColor !== 'transparent') {
      previewCard.classList.remove('no-bloom');
      const glowBoxRgba = hexToRgba(glowColor, 0.28);
      const glowAmbientRgba = hexToRgba(glowColor, 0.35);
      previewCard.style.setProperty('--card-glow', glowBoxRgba);
      previewCard.style.setProperty('--card-glow-shadow', `0 0 25px -2px ${glowBoxRgba}`);
      previewCard.style.setProperty('--card-glow-ambient', glowAmbientRgba);
    } else {
      previewCard.classList.add('no-bloom');
      previewCard.style.setProperty('--card-glow', 'transparent');
      previewCard.style.setProperty('--card-glow-shadow', 'none');
      previewCard.style.setProperty('--card-glow-ambient', 'transparent');
    }

    // Direct text styling on preview spans
    if (previewPrefixAt) previewPrefixAt.style.color = atColor;
    if (previewViewer) previewViewer.style.color = viewerColor;
    if (previewPrefixHash) previewPrefixHash.style.color = hashColor;
    if (previewRewardTitle) previewRewardTitle.style.color = rewardColor;

    previewCard.className = `redeem-card theme-${theme} first-redeemer${!isBorderEnabled || borderColor === 'transparent' ? ' no-border' : ''}${!isBloomEnabled || glowColor === 'transparent' ? ' no-bloom' : ''}${!isShadowEnabled || shadowColor === 'transparent' ? ' no-shadow' : ''}${bgOpacity === 0 ? ' transparent-bg' : ''}`;

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

    const isBorderEnabled = Boolean(borderToggle?.checked);
    const borderColor = isBorderEnabled ? (cardBorderColorPicker?.value || '#c4b5fd') : 'transparent';
    const isBloomEnabled = Boolean(bloomToggle?.checked);
    const glowColor = isBloomEnabled ? (cardGlowColorPicker?.value || '#a855f7') : 'transparent';
    const isShadowEnabled = Boolean(shadowToggle?.checked);
    const shadowColor = isShadowEnabled ? (cardShadowColorPicker?.value || '#000000') : 'transparent';

    const payload = {
      badgeText: badgeTextInput?.value?.trim() || '👑 1ST REDEEMER',
      badgeColor: atColorPicker?.value || '#fbbf24',
      badgeBgColor: 'rgba(245, 158, 11, 0.22)',
      fontFamily: fontFamilySelect?.value || 'Kanit',
      fontSizeScale: parseFloat(fontSizeScaleSelect?.value || '1.0'),
      viewerColor: viewerColorPicker?.value || '#ffffff',
      atColor: atColorPicker?.value || '#fbbf24',
      hashColor: hashColorPicker?.value || '#c4b5fd',
      rewardColor: rewardColorPicker?.value || '#ffffff',
      borderEnabled: isBorderEnabled,
      bloomEnabled: isBloomEnabled,
      shadowEnabled: isShadowEnabled,
      cardShadowColor: shadowColor,
      cardTheme: cardThemeSelect?.value || 'purple',
      cardBgColor: cardBgColorPicker?.value || '#1c1030',
      cardBgOpacity: parseFloat(cardBgOpacitySelect?.value || '0.94'),
      cardBorderColor: borderColor,
      cardGlowColor: glowColor,
      cardRadius: cardRadiusSelect?.value || '16px',
      soundEnabled: Boolean(soundToggle?.checked),
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
      } catch { }
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

