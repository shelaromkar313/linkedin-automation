/**
 * Background Service Worker: Daily 8:00 AM Scheduler & Automation Engine
 * Fully automated, zero-cost (0 Rs) LinkedIn outreach and connection tracker.
 */

// Initialize default settings and alarms on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('[LinkedIn AI Background] Extension installed/updated.');
  setupDailyAlarm(8, 0); // 8:00 AM daily
});

// Setup 8:00 AM daily alarm
function setupDailyAlarm(targetHour = 8, targetMinute = 0) {
  chrome.alarms.clear('dailyLinkedIn8AM', () => {
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(targetHour, targetMinute, 0, 0);

    // If already past 8:00 AM today, schedule for 8:00 AM tomorrow
    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delayInMinutes = Math.max(1, (nextRun.getTime() - now.getTime()) / (1000 * 60));
    chrome.alarms.create('dailyLinkedIn8AM', {
      delayInMinutes: delayInMinutes,
      periodInMinutes: 1440 // Repeat every 24 hours
    });

    console.log(`[LinkedIn AI Background] Daily 8:00 AM alarm scheduled for: ${nextRun.toLocaleString()}`);
  });
}

// Alarm Event Listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyLinkedIn8AM') {
    console.log('[LinkedIn AI Background] ⏰ 8:00 AM Alarm fired! Starting daily outreach...');
    triggerDailyAutopilot();
  }
});

// Launch daily campaign without any manual clicks
async function triggerDailyAutopilot() {
  chrome.storage.local.get(['dailyScheduleActive', 'autopilotConfig', 'targetLocation', 'targetKeyword'], async (data) => {
    // If user has not enabled daily schedule, do not auto-run
    if (data.dailyScheduleActive === false) {
      console.log('[LinkedIn AI Background] Daily schedule is disabled in settings. Skipping.');
      return;
    }

    const keyword = data.targetKeyword || 'CEO';
    // Pune Geographic URN: 103644278
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&geoUrn=%5B%22103644278%22%5D&origin=GLOBAL_SEARCH_HEADER`;

    const config = Object.assign({
      keyword: keyword,
      limit: 15, // Safe free limit: 15 per day
      targetLocation: 'Pune',
      minEmployees: 150
    }, data.autopilotConfig || {});

    // Save state so content script on newly opened tab immediately starts autopilot
    chrome.storage.local.set({
      autopilotActive: true,
      autopilotConfig: config,
      autopilotQueue: [],
      autopilotIndex: 0,
      lastDailyRun: new Date().toISOString()
    }, () => {
      // Create new tab with Pune CEO search URL
      chrome.tabs.create({ url: searchUrl, active: true }, (tab) => {
        console.log(`[LinkedIn AI Background] Launched search tab #${tab.id} for Pune CEOs.`);
      });
    });
  });
}

// Message Listener for Popup Controls
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle_daily_schedule') {
    const isEnabled = request.enabled !== false;
    chrome.storage.local.set({ dailyScheduleActive: isEnabled }, () => {
      if (isEnabled) {
        setupDailyAlarm(8, 0);
      } else {
        chrome.alarms.clear('dailyLinkedIn8AM');
      }
      sendResponse({ success: true, enabled: isEnabled });
    });
    return true;
  }

  if (request.action === 'check_accepted_connections') {
    // Open LinkedIn connections page to auto-detect acceptances and send follow-up messages
    chrome.tabs.create({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/', active: true }, (tab) => {
      chrome.storage.local.set({ checkingAcceptedConnections: true });
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  return false;
});
