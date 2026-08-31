// Optional Slack ping. The sheet is the real output — this only says "the job
// finished, go look". If no token or channel is set, we stay silent and the job
// still works. That is deliberate: not having picked a channel yet must never be
// the thing that blocks a run.
//
// This project posts to OPS_SLACK_CHANNEL and nowhere else. It has no knowledge
// of the marketing channels.

export async function notify(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.OPS_SLACK_CHANNEL;
  if (!token || !channel) {
    console.log('[slack] no token/channel set — skipping (sheet still written)');
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text }),
    });
    const body = await res.json();
    if (!body.ok) console.error('[slack] refused:', body.error);
  } catch (err) {
    console.error('[slack] could not post:', err.message);
  }
}
