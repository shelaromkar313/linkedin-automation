/**
 * LinkedIn AI Connect Assistant - Content Script
 * Manifest V3, Vanilla JS
 * 100% Automated Decision-Maker Outreach Engine (Search -> Profile -> Connect -> Note -> Send)
 * Auto-fallback to Follow & Message when Connect is unavailable (Free Accounts Supported)
 */

(() => {
  if (window.__linkedinAiConnectLoaded) {
    return;
  }
  window.__linkedinAiConnectLoaded = true;

  console.log('[LinkedIn AI Connect] Content script active on:', window.location.href);

  let isAutopilotRunning = false;

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // AUTOPILOT MASTER ORCHESTRATOR
  // ============================================================
  async function checkAndRunAutopilot(force = false) {
    if (!isExtensionValid()) return;
    if (isAutopilotRunning && !force) return;

    try {
      chrome.storage.local.get(['autopilotActive', 'autopilotConfig', 'autopilotQueue', 'autopilotIndex'], async (res) => {
        if (!isExtensionValid() || !res) return;
        if (!res.autopilotActive || !res.autopilotConfig) {
          return;
        }

      isAutopilotRunning = true;
      const config = res.autopilotConfig;
      const currentUrl = window.location.href;

      // ------------------------------------------------------------
      // STAGE 1: ON SEARCH RESULTS PAGE - EXTRACT CANDIDATE PROFILES
      // ------------------------------------------------------------
      if (currentUrl.includes('/search/results/people')) {
        if (isUserLoggedOut()) {
          showAutopilotWidget();
          updateAutopilotWidget('⚠️ You are logged out! Please log into LinkedIn to run Autopilot.', 0, config.limit || 5);
          chrome.storage.local.set({ autopilotActive: false });
          isAutopilotRunning = false;
          return;
        }

        showAutopilotWidget();
        updateAutopilotWidget(`Autopilot: Scanning CEOs for "${config.keyword || 'CEO'}"...`, 0, config.limit || 5);

        await sleep(1500);

        // Auto-scroll slightly to trigger lazy-loaded result cards
        window.scrollBy({ top: 400, behavior: 'smooth' });
        await sleep(1500);

        let candidateLinks = Array.from(
          document.querySelectorAll(
            '.reusable-search__result-container a[href*="/in/"], ' +
            'span.entity-result__title-text a[href*="/in/"], ' +
            'div[data-view-name*="search-entity-result"] a[href*="/in/"], ' +
            'main ul.reusable-search__entity-result-list a[href*="/in/"]'
          )
        );

        if (candidateLinks.length === 0) {
          window.scrollBy({ top: 600, behavior: 'smooth' });
          await sleep(1500);
          candidateLinks = Array.from(document.querySelectorAll('.scaffold-layout__main a[href*="/in/"], main a[href*="/in/"]'));
        }

        candidateLinks = candidateLinks.filter((a) => !isSidebarElement(a) && !a.closest('aside, .scaffold-layout__aside, [data-view-name*="sidebar"]'));

        const profileUrls = candidateLinks
          .map((a) => a.href.split('?')[0].split('#')[0])
          .filter((u) => {
            if (!u.includes('/in/')) return false;
            if (u.includes('/recent-activity/') || u.includes('/detail/') || u.includes('/edit/')) return false;
            if (u.includes('/in/unavailable/') || u.includes('/feed/') || u.endsWith('/in/')) return false;
            return true;
          });

        const uniqueUrls = Array.from(new Set(profileUrls)).slice(0, parseInt(config.limit, 10) || 5);

        if (uniqueUrls.length > 0) {
          updateAutopilotWidget(`Found ${uniqueUrls.length} decision-makers! Opening Candidate #1...`, 0, uniqueUrls.length);
          chrome.storage.local.set({
            autopilotQueue: uniqueUrls,
            autopilotIndex: 0
          });

          await sleep(1500);
          window.location.href = uniqueUrls[0];
        } else {
          updateAutopilotWidget('Waiting for search cards to appear...', 0, config.limit || 5);
          await sleep(3000);
          window.location.reload();
        }
      }

      // ------------------------------------------------------------
      // STAGE 2: ON PROFILE PAGE - SCRAPE, CRAFT NOTE, CONNECT OR FALLBACK
      // ------------------------------------------------------------
      else if (currentUrl.includes('/in/')) {
        let queue = res.autopilotQueue || [];
        let index = res.autopilotIndex || 0;

        // If user started autopilot on a profile directly, add current profile to queue
        if (queue.length === 0) {
          queue = [currentUrl.split('?')[0].split('#')[0]];
          index = 0;
          chrome.storage.local.set({ autopilotQueue: queue, autopilotIndex: 0 });
        }

        if (queue.length > 0 && index < queue.length) {
          showAutopilotWidget();
          updateAutopilotWidget(`Candidate ${index + 1} of ${queue.length}: Loading profile...`, index, queue.length);

          try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) {}
          await sleep(2500);
          try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) {}

          if (isUserLoggedOut()) {
            updateAutopilotWidget('⚠️ LinkedIn session logged out! Please log into LinkedIn and restart Autopilot.', index, queue.length);
            chrome.storage.local.set({ autopilotActive: false });
            isAutopilotRunning = false;
            return;
          }

          // 1. Scrape decision-maker details
          const profile = extractProfileData();

          // 1b. Check Company Employee Count (Target: 150+ Employees)
          const minEmp = parseInt(config.minEmployees, 10) || 0;
          if (minEmp > 0) {
            const detectedEmp = estimateCompanyEmployees();
            if (detectedEmp !== null && detectedEmp < minEmp) {
              console.log(`[LinkedIn AI Connect] Candidate company headcount (~${detectedEmp}) is below target (${minEmp}+). Skipping.`);
              updateAutopilotWidget(`Skipping ${profile.name}: Company headcount (~${detectedEmp}) is under ${minEmp}+.`, index + 1, queue.length);
              await sleep(1500);

              const nextIndex = index + 1;
              if (nextIndex < queue.length) {
                chrome.storage.local.set({ autopilotIndex: nextIndex });
                window.location.href = queue[nextIndex];
                return;
              } else {
                chrome.storage.local.set({ autopilotActive: false, autopilotQueue: [], autopilotIndex: 0 });
                updateAutopilotWidget(`🎉 Campaign Complete! Reached queue end.`, queue.length, queue.length);
                isAutopilotRunning = false;
                return;
              }
            }
          }

          updateAutopilotWidget(`Crafting personalized AI note for ${profile.name}...`, index, queue.length, profile.name);

          // 2. Generate customized note
          const note = await generateAutopilotNote(profile.name, profile.headline, config);
          updateAutopilotWidget(`Automating outreach to ${profile.name}...`, index, queue.length, profile.name, note);

          // 3. Connect, Add Note & Send (or Follow + Message if connect unavailable)
          const result = await executeInsertNote(note, true);

          if (result && result.success) {
            const status = result.isFollowOnly ? 'Followed' : 'Pending';
            const recordedNote = result.isFollowOnly ? '' : note;
            logOutreachLead(profile, status, recordedNote);
            updateAutopilotWidget(`✅ ${result.message || 'Done with ' + profile.name}! Cooldown (4s)...`, index + 1, queue.length, profile.name, recordedNote);
          } else {
            updateAutopilotWidget(`Processed ${profile.name}: ${result?.message || 'Handled'}.`, index + 1, queue.length);
          }

          await sleep(4000);

          // Dismiss any remaining modal before moving
          const remainingModal = getActiveModal();
          if (remainingModal) {
            const dismiss = remainingModal.querySelector('button[aria-label="Dismiss"], button[aria-label="Close"], button[aria-label="close"]');
            if (dismiss) triggerClick(dismiss);
            await sleep(400);
          }

          // Advance to next CEO in queue
          const nextIdx = index + 1;
          if (nextIdx < queue.length) {
            chrome.storage.local.set({ autopilotIndex: nextIdx });
            updateAutopilotWidget(`Opening Candidate ${nextIdx + 1} of ${queue.length}...`, nextIdx, queue.length);
            await sleep(1500);
            window.location.href = queue[nextIdx];
          } else {
            // Finished all targets in queue!
            chrome.storage.local.set({ autopilotActive: false, autopilotQueue: [], autopilotIndex: 0 });
            updateAutopilotWidget(`🎉 Campaign Complete! Successfully reached all ${queue.length} targets.`, queue.length, queue.length);
          }
        }
      }

      // ------------------------------------------------------------
      // STAGE 3: ON CONNECTIONS PAGE - CHECK ACCEPTED & AUTO-MESSAGE
      // ------------------------------------------------------------
      else if (currentUrl.includes('/mynetwork/invite-connect/connections')) {
        await handleAcceptedConnectionsWorkflow();
      }

      isAutopilotRunning = false;
    });
    } catch (e) {
      isAutopilotRunning = false;
    }
  }

  // ============================================================
  // OUTREACH TRACKER & ACCEPTANCE WORKFLOW (ZERO COST CRM)
  // ============================================================
  function logOutreachLead(profile, status = 'Pending', noteText = '') {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get(['outreachHistory'], (res) => {
        if (!isExtensionValid() || !res) return;
        const history = res.outreachHistory || [];
        const cleanUrl = (profile.url || window.location.href).split('?')[0].split('#')[0];
        const existingIdx = history.findIndex((h) => h.url === cleanUrl);

        const record = {
          id: cleanUrl,
          name: profile.name || 'Colleague',
          headline: profile.headline || '',
          company: profile.company || '',
          url: cleanUrl,
          location: profile.location || 'Pune',
          dateSent: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          status: status, // 'Pending' or 'Accepted'
          note: noteText,
          followUpSent: false
        };

        if (existingIdx >= 0) {
          history[existingIdx] = Object.assign(history[existingIdx], record);
        } else {
          history.unshift(record);
        }

        chrome.storage.local.set({ outreachHistory: history.slice(0, 300) });
      });
    } catch (e) {}
  }

  async function handleAcceptedConnectionsWorkflow() {
    showToastBanner('🔍 Checking recently accepted connections...');
    await sleep(2500);

    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get(['outreachHistory', 'customFollowUpMessage'], async (res) => {
        if (!isExtensionValid() || !res) return;
        const history = res.outreachHistory || [];
        const pendingLeads = history.filter((h) => h.status === 'Pending' || !h.followUpSent);

        if (pendingLeads.length === 0) {
          showToastBanner('ℹ️ No pending leads to check right now.');
          return;
        }

        const connectionCards = Array.from(document.querySelectorAll(
          '.mn-connection-card, li.reusable-search__result-container, ul.mn-connection-card__list > li'
        ));

        let updatedCount = 0;

        for (const card of connectionCards) {
          const nameEl = card.querySelector('.mn-connection-card__name, span.entity-result__title-text, a[href*="/in/"]');
          const linkEl = card.querySelector('a[href*="/in/"]');
          if (!nameEl || !linkEl) continue;

          const cardName = (nameEl.innerText || '').trim().toLowerCase();
          const cardUrl = linkEl.href.split('?')[0].split('#')[0].toLowerCase();

          const lead = pendingLeads.find((p) => {
            const pUrl = (p.url || '').toLowerCase();
            const pName = (p.name || '').toLowerCase();
            return pUrl === cardUrl || (pName && cardName.includes(pName));
          });

          if (lead) {
            console.log(`[LinkedIn AI Connect] 🤝 Detected connection accepted by: ${lead.name}!`);
            lead.status = 'Accepted';
            lead.acceptedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

            if (!lead.followUpSent) {
              const msgBtn = card.querySelector('button[aria-label*="Message"], button.artdeco-button, a[href*="/messaging/thread/"]');
              if (msgBtn) {
                console.log(`[LinkedIn AI Connect] Sending follow-up message to ${lead.name}...`);
                triggerClick(msgBtn);
                await sleep(1500);

                const textbox = await waitForElement(
                  'div.msg-form__contenteditable, div[role="textbox"][contenteditable="true"]',
                  3500,
                  document
                );

                if (textbox) {
                  const firstName = lead.name.split(' ')[0] || 'there';
                  const defaultMsg = `Hi ${firstName}, thanks for connecting! Looking forward to sharing industry insights and exploring synergies in Pune.`;
                  const followUpText = res.customFollowUpMessage ? res.customFollowUpMessage.replace('{name}', firstName) : defaultMsg;

                  textbox.focus();
                  try {
                    document.execCommand('insertText', false, followUpText);
                  } catch (e) {
                    textbox.innerText = followUpText;
                  }
                  textbox.dispatchEvent(new Event('input', { bubbles: true }));
                  await sleep(800);

                  const sendBtn = document.querySelector('button.msg-form__send-button:not([disabled]), button[type="submit"].msg-form__send-button');
                  if (sendBtn) {
                    triggerClick(sendBtn);
                    lead.followUpSent = true;
                    updatedCount++;
                    await sleep(1000);
                  }

                  const closeBtn = document.querySelector('button[data-control-name="overlay.close_conversation_bubble"], button[aria-label*="Close conversation"]');
                  if (closeBtn) triggerClick(closeBtn);
                }
              }
            }
          }
        }

        chrome.storage.local.set({ outreachHistory: history, checkingAcceptedConnections: false });
        showToastBanner(`🎉 Acceptance check complete! Updated ${updatedCount} connections.`);
      });
    } catch (e) {}
  }

  // Run on initial load
  checkAndRunAutopilot();

  // Watch for storage activation
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autopilotActive?.newValue === true) {
      checkAndRunAutopilot(true);
    }
  });

  if (isExtensionValid()) {
    try {
      chrome.storage.local.get(['autoConnectOnVisit', 'geminiApiKey', 'pitchProfile', 'autopilotActive'], async (res) => {
        if (!isExtensionValid() || !res) return;
        if (res.autopilotActive) return; // Autopilot orchestrator handles queue

        const isAutoConnect = res.autoConnectOnVisit !== false;
        const currentUrl = window.location.href;

        if (isAutoConnect && currentUrl.includes('/in/') && !currentUrl.includes('/in/unavailable/') && !currentUrl.includes('/edit/')) {
          await sleep(2500);

          if (isUserLoggedOut()) return;
          if (isProfileAlreadyPending()) return;

          const profile = extractProfileData();
          if (!profile || !profile.name || profile.name === 'Colleague') return;

          showToastBanner(`⚡ LinkedIn AI: Auto-connecting to ${profile.name}...`);

          const note = await generateAutopilotNote(profile.name, profile.headline, {
            apiKey: res.geminiApiKey,
            pitch: res.pitchProfile
          });

          const result = await executeInsertNote(note, true);
          if (result && result.success) {
            showToastBanner(`✅ ${result.message || 'Auto-connected with ' + profile.name}!`, 5000);
          } else if (result && result.message) {
            showToastBanner(`ℹ️ ${result.message}`, 4000);
          }
        }
      });
    } catch (e) {}
  }

  function showToastBanner(message, durationMs = 4500) {
    let toast = document.getElementById('li-ai-toast-banner');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'li-ai-toast-banner';
      toast.style.cssText = `
        position: fixed;
        top: 64px;
        right: 24px;
        background: #0f172a;
        color: #ffffff;
        border: 1.5px solid #059669;
        border-radius: 8px;
        padding: 10px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        z-index: 9999999;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'flex';
    toast.style.opacity = '1';

    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
      }
    }, durationMs);
  }

  // ============================================================
  // MESSAGE LISTENER (POPUP CONTROLS)
  // ============================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start_autopilot') {
      checkAndRunAutopilot(true);
      sendResponse({ success: true, message: 'Autopilot initiated!' });
      return true;
    }

    if (request.action === 'get_profile_data') {
      const data = extractProfileData();
      sendResponse({ success: true, profile: data });
      return true;
    }

    if (request.action === 'insert_connect_note') {
      executeInsertNote(request.note, false)
        .then((result) => sendResponse(result))
        .catch((err) => {
          sendResponse({ success: false, message: err.message || 'Error occurred.' });
        });
      return true;
    }

    if (request.action === 'auto_connect_and_send') {
      executeInsertNote(request.note, true)
        .then((result) => sendResponse(result))
        .catch((err) => {
          sendResponse({ success: false, message: err.message || 'Error occurred.' });
        });
      return true;
    }

    return false;
  });

  // ============================================================
  // DOM HELPERS & EVENT DISPATCHERS
  // ============================================================

  function isUserLoggedOut() {
    const url = window.location.href.toLowerCase();
    if (url.includes('/authwall') || url.includes('/login') || url.includes('/checkpoint') || url.includes('/signup')) {
      return true;
    }
    if (document.querySelector('form.join-form, form.login-form, .authwall-sign-in-form, #login-email, #session_key')) {
      return true;
    }
    const hasMeNav = document.querySelector('.global-nav__me, img.global-nav__me-photo, button[aria-label*="Me"]');
    const hasGuestPrompt = document.querySelector('a[href*="/login"], a[href*="/signup"], .join-form, .sign-in-card, .authwall-join-form');
    if (!hasMeNav && hasGuestPrompt) {
      return true;
    }
    if (document.body) {
      const bodyText = document.body.innerText.toLowerCase();
      if (
        (bodyText.includes('sign in with google') || bodyText.includes('join or sign in') || bodyText.includes('sign in to linkedin')) &&
        !hasMeNav
      ) {
        return true;
      }
    }
    return false;
  }

  function isSidebarElement(el) {
    if (!el) return false;
    return !!el.closest(
      'aside, .scaffold-layout__aside, .scaffold-layout__sidebar, [data-view-name*="sidebar"], ' +
      '#profile-content ~ aside, .feed-follows-module, .pv-manage-network-card, section.artdeco-card:not(.scaffold-layout__main *), ' +
      '[data-view-name*="profile-card"]:not(.scaffold-layout__main *), div[data-view-name*="right-rail"]'
    );
  }

  function triggerClick(el) {
    if (!el) return;
    try {
      if (!isSidebarElement(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        }
      }
      el.focus();
    } catch (e) {}

    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
    } catch (e) {
      try { el.click(); } catch (err) {}
    }
  }

  function getActiveModal() {
    // Search strictly for invitation/connection dialog (exclude messaging and dropdown menus)
    const candidates = Array.from(
      document.querySelectorAll(
        '.artdeco-modal, div[role="dialog"], .send-invite, div.send-invite-modal'
      )
    );

    const modalCandidates = candidates.filter(
      (el) => !el.closest('.msg-overlay-container, .msg-overlay-list-bubble, .msg-convo-wrapper, #messaging, .artdeco-dropdown, div[role="menu"]')
    );

    for (const m of modalCandidates) {
      const text = (m.innerText || '').toLowerCase();
      const aria = (m.getAttribute('aria-label') || '').toLowerCase();
      const labelledBy = (m.getAttribute('aria-labelledby') || '').toLowerCase();

      if (
        text.includes('add a note') ||
        text.includes('send without a note') ||
        text.includes('invitation') ||
        text.includes('connect with') ||
        text.includes('how do you know') ||
        aria.includes('invitation') ||
        labelledBy.includes('send-invite') ||
        m.querySelector('#custom-message, textarea, button[aria-label*="note"], button[aria-label*="invitation"]')
      ) {
        return m;
      }
    }

    return null;
  }

  async function waitForModal(timeoutMs = 4500) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const modal = getActiveModal();
      if (modal) return modal;
      await sleep(150);
    }
    return null;
  }

  function isAllowedHeroButton(el) {
    if (!el) return false;

    // 1. Must NOT be in any forbidden non-hero sections or sidebars
    if (el.closest(
      'aside, .scaffold-layout__aside, .scaffold-layout__sidebar, [data-view-name*="sidebar"], ' +
      '#experience, #about, #activity, #education, #skills, #recommendations, ' +
      '[data-view-name*="people-you-may-know"], .feed-follows-module, .pv-manage-network-card, ' +
      '.pvs-list__outer-container, [data-view-name*="right-rail"]'
    )) {
      return false;
    }

    // 2. Reject any section whose heading mentions suggestions or non-hero modules
    const section = el.closest('section');
    if (section) {
      const heading = section.querySelector('h2, h3, h4');
      if (heading) {
        const hText = heading.innerText.toLowerCase();
        if (
          hText.includes('people you may know') ||
          hText.includes('people also viewed') ||
          hText.includes('more profiles') ||
          hText.includes('suggested') ||
          hText.includes('activity') ||
          hText.includes('experience') ||
          hText.includes('education')
        ) {
          return false;
        }
      }
    }

    // 3. Must be strictly inside candidate's top actions container or top card header
    const heroBar = el.closest(
      '.pvs-profile-actions, .pv-top-card-v2-ctas, .pv-top-card__actions, ' +
      '.pv-top-card, .scaffold-layout__main > section:first-of-type'
    );

    return !!heroBar;
  }

  function getMainProfileCard() {
    const h1 = document.querySelector(
      '.scaffold-layout__main h1, main section:first-of-type h1, h1.inline.t-24, h1.text-heading-xlarge'
    );
    if (h1) {
      const section = h1.closest('section');
      if (section && !isSidebarElement(section)) {
        return section;
      }
    }
    const topCard = document.querySelector('.pv-top-card, .scaffold-layout__main > section:first-of-type');
    if (topCard && !isSidebarElement(topCard)) {
      return topCard;
    }
    return document.querySelector('.scaffold-layout__main > section:first-of-type') || null;
  }

  function getProfileActionsContainer() {
    const heroActions = document.querySelector(
      '.scaffold-layout__main .pvs-profile-actions, ' +
      '.pv-top-card .pvs-profile-actions, ' +
      '.pv-top-card-v2-ctas, ' +
      '.pv-top-card__actions, ' +
      '.scaffold-layout__main > section:first-of-type div.ph5.pb5'
    );
    if (heroActions && !isSidebarElement(heroActions)) {
      return heroActions;
    }

    const firstSection = getMainProfileCard();
    if (firstSection) return firstSection;

    return null;
  }

  function isProfileAlreadyPending() {
    const container = getProfileActionsContainer();
    if (!container) return false;
    const buttons = Array.from(container.querySelectorAll('button, div[role="button"], a')).filter(isAllowedHeroButton);
    return buttons.some((b) => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      const a = (b.getAttribute('aria-label') || '').toLowerCase();
      return t === 'pending' || a.includes('pending') || t === 'withdraw' || a.includes('withdraw');
    });
  }

  function isProfileAlreadyFollowing() {
    const container = getProfileActionsContainer();
    if (!container) return false;
    const buttons = Array.from(container.querySelectorAll('button, div[role="button"], a')).filter(isAllowedHeroButton);
    return buttons.some((b) => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      const a = (b.getAttribute('aria-label') || '').toLowerCase();
      return t === 'following' || a === 'following' || a.includes('following');
    });
  }

  function getAddNoteButton(context) {
    const dialog = context || getActiveModal() || document;
    const roots = [dialog];
    if (dialog !== document) roots.push(document);

    for (const root of roots) {
      const elements = Array.from(root.querySelectorAll('button, div[role="button"], a, span'));

      for (const el of elements) {
        if (el.closest('.msg-overlay-container, .msg-overlay-list-bubble, #messaging, aside')) {
          continue;
        }

        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();

        if (
          (text === 'add a note' || aria === 'add a note' ||
           ((text.includes('note') || aria.includes('note')) && (text.includes('add') || aria.includes('add')))) &&
          !text.includes('without') &&
          !aria.includes('without')
        ) {
          const btn = el.tagName.toLowerCase() === 'button' || el.getAttribute('role') === 'button'
            ? el
            : el.closest('button, div[role="button"]') || el;
          console.log('[LinkedIn AI Connect] Found "Add a note" button:', btn);
          return btn;
        }
      }
    }

    return null;
  }

  function getSendButton(context) {
    const dialog = context || getActiveModal() || document;
    const roots = [dialog];
    if (dialog !== document) roots.push(document);

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll('button, div[role="button"], a'));

      for (const b of buttons) {
        if (b.closest('.msg-overlay-container, .msg-overlay-list-bubble, #messaging, aside')) {
          continue;
        }

        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (text.includes('without') || aria.includes('without')) continue;
        if (
          text === 'send' ||
          text === 'send invitation' ||
          text === 'send now' ||
          aria === 'send' ||
          aria === 'send invitation' ||
          aria === 'send now' ||
          text.includes('send invitation') ||
          aria.includes('send invitation')
        ) {
          return b;
        }
      }

      const primary = root.querySelector(
        '.artdeco-modal button.artdeco-button--primary, ' +
        'button.artdeco-button--primary'
      );
      if (primary && !primary.closest('.msg-overlay-container, .msg-overlay-list-bubble, #messaging, aside')) {
        return primary;
      }
    }

    return null;
  }

  function getSendWithoutNoteButton(context) {
    const dialog = context || getActiveModal() || document;
    const roots = [dialog];
    if (dialog !== document) roots.push(document);

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll('button, div[role="button"], a'));

      for (const b of buttons) {
        if (b.closest('.msg-overlay-container, .msg-overlay-list-bubble, #messaging, aside')) {
          continue;
        }

        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (
          text.includes('without') ||
          aria.includes('without') ||
          text === 'send now' ||
          aria === 'send now'
        ) {
          if (!text.includes('add note') && !aria.includes('add note')) {
            return b;
          }
        }
      }

      const primary = root.querySelector('button.artdeco-button--primary');
      if (primary && !primary.closest('.msg-overlay-container, .msg-overlay-list-bubble, #messaging, aside')) {
        return primary;
      }
    }

    return null;
  }

  function findMoreActionsButton() {
    const actionsBar = getProfileActionsContainer();
    if (!actionsBar) return null;

    const buttons = Array.from(actionsBar.querySelectorAll('button, div[role="button"]')).filter(isAllowedHeroButton);

    // Priority 1: Check aria-label containing "More action" or "More"
    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('more action') || aria === 'more') return btn;
    }

    // Priority 2: Look for button with artdeco-dropdown__trigger, circle button, or SVG ellipsis/overflow icon
    for (const btn of buttons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        btn.classList.contains('artdeco-dropdown__trigger') ||
        btn.classList.contains('artdeco-button--circle') ||
        btn.querySelector('svg[data-test-icon*="overflow"], svg[data-test-icon*="ellipsis"], svg[data-test-icon*="dots"], use[href*="overflow"], use[href*="ellipsis"]') ||
        text === 'more' ||
        text === '...'
      ) {
        return btn;
      }
    }

    return null;
  }

  function findDirectConnectButton() {
    const actionsBar = getProfileActionsContainer();
    if (!actionsBar) return null;

    const candidateButtons = Array.from(actionsBar.querySelectorAll('button, div[role="button"], a')).filter(isAllowedHeroButton);
    for (const btn of candidateButtons) {
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

      if (
        (text === 'connect' || text === '+ connect' || aria === 'connect' || /^invite.*to connect$/i.test(aria) || (aria.includes('invite') && aria.includes('connect'))) &&
        !text.includes('message') &&
        !text.includes('following') &&
        !text.includes('pending')
      ) {
        if (!/pending|dismiss|withdraw/i.test(text)) {
          return btn;
        }
      }
    }
    return null;
  }

  function findConnectMenuItem() {
    // Dropdown container MUST be strictly an open artdeco-dropdown content or role="menu"
    const openMenus = Array.from(document.querySelectorAll(
      '.artdeco-dropdown__content--is-open, ' +
      '.artdeco-dropdown--is-open .artdeco-dropdown__content, ' +
      'div[role="menu"], ' +
      '.pvs-profile-actions .artdeco-dropdown__content, ' +
      '.pv-top-card-v2-ctas .artdeco-dropdown__content'
    )).filter((m) => {
      // STRICT FILTER: NEVER look in sidebar, messaging, or global nav!
      if (isSidebarElement(m) || m.closest('.msg-overlay-container, #messaging, .global-nav')) {
        return false;
      }
      const style = window.getComputedStyle(m);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    for (const menu of openMenus) {
      // Search ONLY inside this active dropdown menu
      const candidates = Array.from(menu.querySelectorAll(
        '.artdeco-dropdown__item, [role="menuitem"], [role="button"], li, div, span, button'
      ));

      for (const el of candidates) {
        if (isSidebarElement(el) || el.closest('.msg-overlay-container, #messaging')) continue;

        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();

        // Exact match for "Connect" or "+ Connect"
        if (/^\+?\s*connect$/i.test(text) || aria === 'connect' || /invite.*to connect/i.test(aria)) {
          if (!/following|connections|pending|remove|message/i.test(text)) {
            const clickable = el.closest('.artdeco-dropdown__item, [role="menuitem"], [role="button"], li, button') || el;
            console.log('[LinkedIn AI Connect] 🎯 Found Connect dropdown item inside menu:', clickable);
            return clickable;
          }
        }
      }

      // Check for connect icon inside dropdown menu
      const connectIcon = menu.querySelector('li-icon[type="connect"], svg[data-test-icon*="connect"], use[href*="connect"]');
      if (connectIcon) {
        const item = connectIcon.closest('.artdeco-dropdown__item, [role="menuitem"], [role="button"], li, button') || connectIcon;
        console.log('[LinkedIn AI Connect] 🎯 Found Connect item via connect icon inside menu:', item);
        return item;
      }
    }

    return null;
  }

  function clickConnectItem(el) {
    if (!el) return;
    console.log('[LinkedIn AI Connect] 🚀 Dispatching robust click to Connect item:', el);

    try {
      if (!isSidebarElement(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        }
      }
      el.focus();
    } catch (e) {}

    // Calculate real screen coordinates for LinkedIn/Ember event verification
    const rect = el.getBoundingClientRect();
    const cx = rect.left + Math.max(2, rect.width / 2);
    const cy = rect.top + Math.max(2, rect.height / 2);

    const mouseOptsDown = {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: 1,
      screenX: window.screenX + cx,
      screenY: window.screenY + cy,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1
    };

    const mouseOptsUp = {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: 1,
      screenX: window.screenX + cx,
      screenY: window.screenY + cy,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 0
    };

    // 1. Dispatch pointerdown and mousedown
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, mouseOptsDown)));
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', mouseOptsDown));
    } catch (e) {}

    // 2. Dispatch pointerup and mouseup
    try {
      el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, mouseOptsUp)));
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mouseup', mouseOptsUp));
    } catch (e) {}

    // 3. Dispatch click
    try {
      el.dispatchEvent(new MouseEvent('click', mouseOptsUp));
    } catch (e) {}
    try {
      el.click();
    } catch (e) {}

    // 4. Accessibility Keyboard Enter/Space (LinkedIn Ember role="button" handles keydown)
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}

    // 5. Also trigger inner span or div child directly
    const inner = el.querySelector('span, div') || el;
    if (inner && inner !== el) {
      try {
        inner.dispatchEvent(new MouseEvent('mousedown', mouseOptsDown));
        inner.dispatchEvent(new MouseEvent('mouseup', mouseOptsUp));
        inner.dispatchEvent(new MouseEvent('click', mouseOptsUp));
        inner.click();
      } catch (e) {}
    }
  }

  async function openMoreMenuAndClickConnect() {
    // 1. Locate the "..." (More actions) button on candidate hero card
    const moreBtn = findMoreActionsButton();
    if (!moreBtn) {
      console.log('[LinkedIn AI Connect] More actions (...) button not found on hero card.');
      return null;
    }

    // 2. Click "..." button to reveal dropdown
    console.log('[LinkedIn AI Connect] Clicking "..." (More actions) button to reveal dropdown...', moreBtn);
    triggerClick(moreBtn);

    // 3. Poll up to 2.5s for the Connect menu item inside the opened dropdown
    let connectItem = null;
    for (let i = 0; i < 20; i++) {
      await sleep(120);
      connectItem = findConnectMenuItem();
      if (connectItem) break;
      if (i === 8) {
        try { moreBtn.click(); } catch (e) {}
      }
    }

    if (!connectItem) {
      console.log('[LinkedIn AI Connect] Connect option is not available in "More" menu for this profile.');
      // Close dropdown if still open
      try { moreBtn.click(); } catch (e) {}
      return null;
    }

    console.log('[LinkedIn AI Connect] 🎯 Found Connect option inside dropdown! Clicking...', connectItem);
    clickConnectItem(connectItem);

    // 4. Wait for invitation modal to appear
    let modal = await waitForModal(4500);
    if (!modal) {
      console.log('[LinkedIn AI Connect] Modal did not appear on first click, trying inner element...');
      const inner = connectItem.querySelector('span, svg, div') || connectItem;
      clickConnectItem(inner);
      modal = await waitForModal(3000);
    }

    return modal;
  }

  function findButtonByText(container, keywords) {
    const buttons = Array.from((container || document).querySelectorAll('button'));
    return buttons.find((btn) => {
      const text = (btn.innerText || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()) || aria.includes(kw.toLowerCase()));
    });
  }

  function findRadioOrButtonByText(container, keywords) {
    const items = Array.from((container || document).querySelectorAll('label, button, div[role="radio"]'));
    return items.find((item) => {
      const text = (item.innerText || '').toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }

  async function waitForElement(selector, timeoutMs = 3000, context = document) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const el = context.querySelector(selector);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  function simulateHumanInput(textarea, text) {
    if (!textarea) return;
    try {
      textarea.focus();
      textarea.click();
    } catch (e) {}

    // 1. Reset existing value & value tracker to ensure React detects change
    textarea.value = '';
    const tracker = textarea._valueTracker;
    if (tracker) {
      try { tracker.setValue(''); } catch (e) {}
    }

    // 2. Set native value using prototype descriptor
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }

    // 3. Dispatch modern InputEvent with inputType and data
    try {
      const inputEvt = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        view: window,
        inputType: 'insertText',
        data: text
      });
      textarea.dispatchEvent(inputEvt);
    } catch (e) {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4. Dispatch standard events for React / Ember
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    textarea.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

    // 5. Native execCommand fallback for React controlled content
    try {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      document.execCommand('insertText', false, text);
    } catch (e) {}
  }

  function highlightElement(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const originalBorder = el.style.border;
    const originalBoxShadow = el.style.boxShadow;

    el.style.border = '2px solid #10b981';
    el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.4)';
    el.style.transition = 'all 0.3s ease';

    setTimeout(() => {
      el.style.border = originalBorder;
      el.style.boxShadow = originalBoxShadow;
    }, 2500);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // SINGLE PROFILE EXTRACTION
  // ============================================================

  function extractProfileData() {
    let name = '';
    let headline = '';
    let company = '';

    const nameSelectors = [
      'h1.inline.t-24.v-align-middle.break-words',
      'h1.text-heading-xlarge',
      'div.pv-text-details__left-panel h1',
      'main section h1',
      '.pv-top-card--list h1',
      '.pv-top-card-v2-ctas h1'
    ];

    for (const selector of nameSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        name = cleanText(el.innerText);
        break;
      }
    }

    if (!name && document.title) {
      const parts = document.title.split('|')[0].split('-');
      if (parts.length > 0 && parts[0].trim()) {
        name = cleanText(parts[0]);
      }
    }

    const headlineSelectors = [
      'div.text-body-medium.break-words',
      'div.pv-text-details__left-panel div.text-body-medium',
      '.ph5 .text-body-medium',
      'div[data-generated-suggestion-target]',
      '.pv-top-card--list + div',
      'main section .text-body-medium',
      'h2.text-body-medium'
    ];

    for (const selector of headlineSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        const text = cleanText(el.innerText);
        if (text && text !== name && !text.match(/^(?:He\/Him|She\/Her|They\/Them)$/i)) {
          headline = text;
          break;
        }
      }
    }

    const companySelectors = [
      'button[aria-label*="Current company"]',
      'ul.pv-text-details__right-panel li:first-child button',
      'ul.pv-text-details__right-panel li:first-child .inline-show-more-text',
      '.pv-text-details__right-panel li:first-child',
      'div.pv-text-details__right-panel span[aria-hidden="true"]',
      '#experience ~ .pvs-list__outer-container li:first-child .t-bold span[aria-hidden="true"]'
    ];

    for (const selector of companySelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        company = cleanText(el.innerText);
        break;
      }
    }

    if (!company && headline) {
      const match = headline.match(/(?:at|@|for|founder of|ceo of)\s+([A-Z0-9][A-Za-z0-9&.\- ]{2,40})/i);
      if (match && match[1]) {
        company = match[1].trim();
      }
    }

    let location = 'Pune, Maharashtra, India';
    const locationSelectors = [
      'span.text-body-small.inline.t-black--light.break-words',
      'div.pv-text-details__left-panel span.text-body-small',
      '.pv-top-card--list-bullet > li:first-child',
      'main section .text-body-small'
    ];
    for (const selector of locationSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        const loc = cleanText(el.innerText);
        if (loc && !loc.includes('connections') && !loc.includes('followers') && !loc.includes('contact info')) {
          location = loc;
          break;
        }
      }
    }

    return {
      name: name || 'Colleague',
      headline: headline || 'Industry Leader',
      company: company || '',
      location: location || 'Pune',
      url: window.location.href
    };
  }

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function estimateCompanyEmployees() {
    try {
      const expElements = Array.from(document.querySelectorAll('#experience ~ div, .experience-item, [data-view-name*="experience"], .pvs-list__outer-container'));
      const textToScan = expElements.length > 0 
        ? expElements.map((el) => el.innerText).join(' ') 
        : (document.body ? document.body.innerText : '');

      const match = textToScan.match(/(\d[\d,]*)\s*(?:-\s*(\d[\d,]*))?\s*(?:\+)?\s*employees/i);
      if (match) {
        const low = parseInt(match[1].replace(/,/g, ''), 10);
        const high = match[2] ? parseInt(match[2].replace(/,/g, ''), 10) : low;
        return high || low;
      }
    } catch (e) {}
    return null;
  }

  // ============================================================
  // FALLBACK ENGINE: FOLLOW ACCOUNT (HERO SECTION ONLY, NO INMAIL)
  // ============================================================

  function findFollowButton() {
    const topArea = getProfileActionsContainer() || getMainProfileCard();
    if (!topArea) return null;

    const buttons = Array.from(topArea.querySelectorAll('button, div[role="button"], a'));
    for (const btn of buttons) {
      // NEVER touch sidebar, suggested accounts, or messaging!
      if (btn.closest('.msg-overlay-container, #messaging, .global-nav, aside, .scaffold-layout__aside, .scaffold-layout__sidebar, [data-view-name*="sidebar"]')) {
        continue;
      }
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

      if (
        (text === 'follow' || text === '+ follow' || aria === 'follow' || (aria.includes('follow') && !aria.includes('following') && !aria.includes('unfollow'))) &&
        !text.includes('following') && !text.includes('unfollow')
      ) {
        return btn;
      }
    }
    return null;
  }

  function isModalForCandidate(modal, candidateName) {
    if (!modal || !candidateName || candidateName === 'Colleague') return true;
    const firstName = candidateName.trim().split(' ')[0].toLowerCase();
    if (firstName.length < 3) return true;

    const modalText = (modal.innerText || '').toLowerCase();
    if (modalText.includes(firstName)) {
      return true;
    }
    if (modalText.includes('add a note') && modalText.includes('send without a note')) {
      return true;
    }
    return false;
  }

  async function executeFollowFallback() {
    console.log('[LinkedIn AI Connect] Connect unavailable on hero card. Executing Fallback: Following account only...');
    let followed = false;

    // Check if already following
    if (isProfileAlreadyFollowing()) {
      console.log('[LinkedIn AI Connect] Account is already followed.');
      followed = true;
    } else {
      let followBtn = findFollowButton();
      if (followBtn) {
        console.log('[LinkedIn AI Connect] Found Follow button on hero card, clicking...', followBtn);
        triggerClick(followBtn);
        followed = true;
        await sleep(1000);
      }
    }

    return {
      success: true,
      isFollowOnly: true,
      message: followed ? 'Followed account successfully (Connect unavailable).' : 'Profile processed.'
    };
  }

  // ============================================================
  // CORE EXECUTION: CONNECT WITH AI NOTE (OR AUTO-FALLBACK)
  // ============================================================

  async function executeInsertNote(noteText, autoSend = false) {
    console.log('[LinkedIn AI Connect] Starting executeInsertNote, autoSend:', autoSend);

    if (isUserLoggedOut()) {
      return {
        success: false,
        message: 'You appear to be logged out of LinkedIn. Please log in.'
      };
    }

    const currentProfile = extractProfileData();

    // 1. Check if candidate already shows "Pending"
    if (isProfileAlreadyPending()) {
      return {
        success: true,
        message: 'Already pending connection'
      };
    }

    let modal = getActiveModal();

    // STEP 1: Check for direct Connect button on candidate's hero action bar
    if (!modal) {
      console.log('[LinkedIn AI Connect] Checking hero action bar for direct Connect button...');
      const directConnectBtn = findDirectConnectButton();
      if (directConnectBtn) {
        console.log('[LinkedIn AI Connect] Found direct Connect button on hero card! Clicking...', directConnectBtn);
        triggerClick(directConnectBtn);
        modal = await waitForModal(4500);
      }
    }

    // STEP 2: If no direct Connect, check 3-dots button on candidate's hero action bar
    if (!modal) {
      console.log('[LinkedIn AI Connect] Checking 3-dots button (...) on hero action bar...');
      modal = await openMoreMenuAndClickConnect();
    }

    // SAFETY CHECK: Verify that the opened modal actually belongs to the current candidate
    if (modal && !isModalForCandidate(modal, currentProfile.name)) {
      console.warn('[LinkedIn AI Connect] ⚠️ Safety violation: Modal opened for wrong candidate! Dismissing modal.');
      const dismiss = modal.querySelector('button[aria-label="Dismiss"], button[aria-label="Close"], button[aria-label="close"]');
      if (dismiss) triggerClick(dismiss);
      modal = null;
    }

    // STEP 3: If modal STILL did not open, Connect is not available on this candidate
    if (!modal) {
      console.log('[LinkedIn AI Connect] Neither direct Connect nor 3-dots Connect is available on this CEO hero card.');
      console.log('[LinkedIn AI Connect] Executing Follow fallback strictly on candidate hero card...');
      return await executeFollowFallback();
    }

    await sleep(600);

    // Safety: Check for weekly limit restriction
    if (/weekly invitation limit|reached the weekly limit|try again next week/i.test(modal.innerText)) {
      chrome.storage.local.set({ autopilotActive: false });
      const dismiss = modal.querySelector('button[aria-label="Dismiss"], button[aria-label="Close"], button[aria-label="close"]');
      if (dismiss) triggerClick(dismiss);
      return {
        success: false,
        message: 'Weekly LinkedIn invitation limit reached.'
      };
    }

    // Safety: Check if recipient requires personal email address
    if (modal.querySelector('input[type="email"]') || /enter.*email/i.test(modal.innerText)) {
      console.log('[LinkedIn AI Connect] Recipient requires personal email. Dismissing modal and executing Follow fallback...');
      const dismiss = modal.querySelector('button[aria-label="Dismiss"], button[aria-label="Close"], button[aria-label="close"]');
      if (dismiss) triggerClick(dismiss);
      await sleep(600);
      return await executeFollowFallback();
    }

    // Intermediate "How do you know each other?" check
    const otherOption = findRadioOrButtonByText(modal, ['Other', 'We know each other']);
    if (otherOption) {
      console.log('[LinkedIn AI Connect] Selecting "Other" relationship reason...');
      triggerClick(otherOption);
      await sleep(400);
      const nextConnectBtn = findButtonByText(modal, ['Connect', 'Next']);
      if (nextConnectBtn) triggerClick(nextConnectBtn);
      await sleep(700);
      modal = getActiveModal() || modal;
    }

    // Find and click "Add a note" button
    let textarea = document.querySelector(
      'textarea#custom-message, textarea[name="message"], .artdeco-modal textarea, div[role="dialog"]:not(.msg-overlay-container *) textarea, textarea'
    );
    if (!textarea) {
      const addNoteBtn = getAddNoteButton(modal);
      if (addNoteBtn) {
        console.log('[LinkedIn AI Connect] Found "Add a note" button, clicking...', addNoteBtn);
        triggerClick(addNoteBtn);
        const innerNote = addNoteBtn.querySelector('span');
        if (innerNote) {
          try { triggerClick(innerNote); } catch (e) {}
        }
        await sleep(800);
      }
      textarea = await waitForElement(
        'textarea#custom-message, textarea[name="message"], .artdeco-modal textarea, div[role="dialog"]:not(.msg-overlay-container *) textarea, textarea',
        4000,
        document
      );
    }

    if (textarea) {
      console.log('[LinkedIn AI Connect] Textarea found, typing personalized note...');
      simulateHumanInput(textarea, noteText);
      highlightElement(textarea);

      if (autoSend) {
        await sleep(800);
        let sendBtn = null;
        for (let waitSec = 0; waitSec < 8; waitSec++) {
          const currentModal = getActiveModal() || modal;
          sendBtn = getSendButton(currentModal) || getSendButton(document);
          if (sendBtn && !sendBtn.disabled && !sendBtn.classList.contains('artdeco-button--disabled')) {
            break;
          }
          if (waitSec >= 4 && sendBtn) {
            console.log('[LinkedIn AI Connect] Force-enabling Send button in modal...');
            sendBtn.removeAttribute('disabled');
            sendBtn.classList.remove('artdeco-button--disabled');
            break;
          }
          await sleep(400);
        }

        if (sendBtn) {
          console.log('[LinkedIn AI Connect] Clicking Send invitation button...', sendBtn);
          clickConnectItem(sendBtn);
          triggerClick(sendBtn);
          const innerSend = sendBtn.querySelector('span');
          if (innerSend) {
            try { triggerClick(innerSend); } catch (e) {}
          }
          await sleep(1500);

          try {
            const profile = extractProfileData();
            logOutreachLead(profile, 'Pending', noteText);
          } catch (e) {}

          // User instruction: "and then write note and go to follow button this is simple process"
          if (!isProfileAlreadyFollowing()) {
            console.log('[LinkedIn AI Connect] Now checking for Follow button to follow account...');
            await sleep(800);
            const followBtn = findFollowButton();
            if (followBtn) {
              console.log('[LinkedIn AI Connect] Clicking Follow button on hero card...', followBtn);
              triggerClick(followBtn);
              await sleep(1000);
            }
          }

          return {
            success: true,
            message: 'Personalized invite sent & account followed!'
          };
        }
      }

      return {
        success: true,
        message: 'Note successfully inserted into Connect modal!'
      };
    }

    // Fallback: Send without note if textarea not revealed
    if (autoSend) {
      console.log('[LinkedIn AI Connect] Fallback: Sending connection request without note...');
      const fallbackBtn = getSendWithoutNoteButton(modal);
      if (fallbackBtn) {
        triggerClick(fallbackBtn);
        await sleep(1200);

        try {
          const profile = extractProfileData();
          logOutreachLead(profile, 'Pending', '');
        } catch (e) {}

        if (!isProfileAlreadyFollowing()) {
          const followBtn = findFollowButton();
          if (followBtn) triggerClick(followBtn);
        }

        return {
          success: true,
          message: 'Connection request sent without note (fallback).'
        };
      }
    }

    return {
      success: true,
      message: 'Connection attempt completed.'
    };
  }

  // ============================================================
  // AI NOTE GENERATOR (GEMINI, GROQ, OPENROUTER, TEMPLATE)
  // ============================================================
  async function generateAutopilotNote(name, headline, config) {
    const apiKey = (config.apiKey || '').trim();
    const pitch = config.pitch || 'Unified Enterprise - IT technology solutions, telecommunications, and custom automation infrastructure';
    const firstName = name.split(' ')[0] || 'there';
    const cleanHeadline = (headline || 'hardware manufacturing').replace(/[\r\n\t]+/g, ' ').slice(0, 35).trim();
    const fallbackNote = `Hi ${firstName}, saw your leadership work in ${cleanHeadline}. Would love to connect and share industry insights!`;

    if (!apiKey) {
      return fallbackNote;
    }

    const prompt = `Draft a personalized 1-sentence LinkedIn connection request note for ${name} (${headline}).
Pitch context: ${pitch}
Directives: Strictly under 220 characters total. Highlight synergy. Do not pitch directly. Output only the ready-to-send note without quotes, bullets, or preambles.`;

    // 1. Groq Cloud (Free high-speed Llama 3.3)
    if (apiKey.startsWith('gsk_')) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 60,
            temperature: 0.5
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = cleanTextForNote(data.choices?.[0]?.message?.content);
          if (text) return text;
        }
      } catch (e) {}
    }

    // 2. OpenRouter / OpenAI
    if (apiKey.startsWith('sk-')) {
      const endpoint = apiKey.startsWith('sk-or-')
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const model = apiKey.startsWith('sk-or-') ? 'meta-llama/llama-3.1-8b-instruct:free' : 'gpt-4o-mini';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 60,
            temperature: 0.5
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = cleanTextForNote(data.choices?.[0]?.message?.content);
          if (text) return text;
        }
      } catch (e) {}
    }

    // 3. Google Gemini API - strictly require AIzaSy to prevent 404 errors
    if (apiKey.startsWith('AIzaSy')) {
      const geminiModels = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'];
      for (const m of geminiModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 60 }
            })
          });

          if (res.ok) {
            const data = await res.json();
            let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            text = cleanTextForNote(text);
            if (text) return text;
          }
        } catch (e) {}
      }
    }

    return fallbackNote;
  }

  function cleanTextForNote(text) {
    if (!text) return '';
    let cleaned = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^(\*|-|\d+\.)?\s*(constraint|rule|directives|note:)/i.test(l))
      .join(' ')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\[(?:Your Name|Name|My Name)\]/gi, '')
      .trim();

    if (cleaned.length > 240) {
      const idx = cleaned.lastIndexOf('.', 238);
      cleaned = idx > 100 ? cleaned.slice(0, idx + 1) : cleaned.slice(0, 235) + '.';
    }
    return cleaned;
  }

  // ============================================================
  // FLOATING ON-SCREEN AUTOPILOT DASHBOARD
  // ============================================================
  function showAutopilotWidget() {
    let widget = document.getElementById('ai-autopilot-panel');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'ai-autopilot-panel';
      widget.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 320px;
        background: #0f172a;
        color: #ffffff;
        border: 2px solid #0a66c2;
        border-radius: 12px;
        padding: 14px 16px;
        box-shadow: 0 12px 30px rgba(0,0,0,0.5);
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12.5px;
        line-height: 1.4;
      `;
      widget.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 8px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #38bdf8; font-size: 13px;">
            <span>⚡ AI Autopilot</span>
            <span style="background: #10b981; color: #fff; font-size: 9.5px; padding: 1px 6px; border-radius: 10px;">LIVE</span>
          </div>
          <button id="autopilot-close-btn" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px;">✕</button>
        </div>
        <div id="autopilot-status-text" style="color: #cbd5e1; margin-bottom: 6px; font-weight: 500;">Initializing Autopilot...</div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 4px;">
          <span>Campaign Progress</span>
          <span id="autopilot-counter" style="font-weight: 700; color: #38bdf8;">0 / 5</span>
        </div>
        <div style="background: #1e293b; border-radius: 4px; height: 6px; overflow: hidden; margin-bottom: 10px;">
          <div id="autopilot-bar" style="background: #0a66c2; width: 0%; height: 100%; transition: width 0.3s;"></div>
        </div>
        <div id="autopilot-note-box" style="background: #1e293b; border-radius: 6px; padding: 8px; font-size: 11px; color: #94a3b8; max-height: 60px; overflow-y: auto; margin-bottom: 10px; display: none;"></div>
        <button id="autopilot-stop-btn" style="width: 100%; padding: 6px 12px; background: #ef4444; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
          🛑 Stop Autopilot
        </button>
      `;
      document.body.appendChild(widget);

      document.getElementById('autopilot-close-btn').addEventListener('click', () => {
        chrome.storage.local.set({ autopilotActive: false });
        widget.remove();
      });

      document.getElementById('autopilot-stop-btn').addEventListener('click', () => {
        chrome.storage.local.set({ autopilotActive: false });
        updateAutopilotWidget('Autopilot stopped by user.', 0, 0);
      });
    }
    widget.style.display = 'block';
  }

  function updateAutopilotWidget(statusText, sent, total, candidateName = '', note = '') {
    const statusEl = document.getElementById('autopilot-status-text');
    const counterEl = document.getElementById('autopilot-counter');
    const barEl = document.getElementById('autopilot-bar');
    const noteBox = document.getElementById('autopilot-note-box');

    if (statusEl) statusEl.textContent = statusText;
    if (counterEl) counterEl.textContent = `${sent} / ${total}`;
    if (barEl) {
      const pct = Math.min(100, Math.round((sent / Math.max(1, total)) * 100));
      barEl.style.width = `${pct}%`;
    }
    if (noteBox && note) {
      noteBox.style.display = 'block';
      noteBox.textContent = `📝 "${note}"`;
    }
  }

  // ============================================================
  // ON-PAGE INVITATION MODAL WATCHER
  // ============================================================
  const modalWatcherTimer = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(modalWatcherTimer);
      return;
    }

    const modal = getActiveModal();
    if (!modal) return;

    const modalText = (modal.innerText || '').toLowerCase();
    if (modalText.includes('add a note') || modalText.includes('send without a note')) {
      if (!window.__liAutoModalHandling) {
        window.__liAutoModalHandling = true;
        try {
          chrome.storage.local.get(['autopilotConfig', 'geminiApiKey', 'pitchProfile', 'autoSendModal'], async (res) => {
            if (!isExtensionValid() || !res) return;
            if (res.autoSendModal !== false) {
              console.log('[LinkedIn AI Connect] Invitation modal detected! Auto-typing note and sending...');
              const p = extractProfileData();
              const note = await generateAutopilotNote(p.name, p.headline, res.autopilotConfig || {
                apiKey: res.geminiApiKey,
                pitch: res.pitchProfile
              });
              await executeInsertNote(note, true);
            }
            window.__liAutoModalHandling = false;
          });
        } catch (e) {
          window.__liAutoModalHandling = false;
        }
      }

      if (!modal.querySelector('#li-quick-send-note-btn')) {
        const header = modal.querySelector('.artdeco-modal__header, h2') || modal;
        const quickBtn = document.createElement('button');
        quickBtn.id = 'li-quick-send-note-btn';
        quickBtn.innerHTML = '⚡ Auto-Send AI Note';
        quickBtn.style.cssText = `
          background: #059669;
          color: #ffffff;
          border: none;
          border-radius: 16px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          margin-left: 12px;
          box-shadow: 0 2px 8px rgba(5, 150, 105, 0.4);
          vertical-align: middle;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          z-index: 999;
        `;
        quickBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          quickBtn.innerText = 'Crafting & Sending...';
          quickBtn.disabled = true;

          const p = extractProfileData();
          if (!isExtensionValid()) return;
          try {
            chrome.storage.local.get(['pitchProfile', 'geminiApiKey'], async (st) => {
              if (!isExtensionValid() || !st) return;
              const note = await generateAutopilotNote(p.name, p.headline, {
                apiKey: st.geminiApiKey,
                pitch: st.pitchProfile
              });
              await executeInsertNote(note, true);
              quickBtn.innerText = 'Sent!';
            });
          } catch (err) {}
        };

        const targetHeader = modal.querySelector('h2') || header;
        if (targetHeader) {
          targetHeader.appendChild(quickBtn);
        }
      }
    }
  }, 900);
})();
