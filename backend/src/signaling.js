
const WebSocket = require('ws');

const topics = new Map();

const send = (conn, message) => {
  if (conn.readyState !== WebSocket.OPEN) {
    conn.close();
  }
  try {
    conn.send(message);
  } catch (e) {
    conn.close();
  }
};

const setupSignalingConnection = (conn, req) => {
    conn.subscribedTopics = new Set();
    
    conn.on('message', message => {
        let parsed;
        try {
            parsed = JSON.parse(message);
        } catch (e) {
            return;
        }
        
        if (parsed && parsed.type === 'subscribe') {
            (parsed.topics || []).forEach(topicName => {
                if (!topics.has(topicName)) {
                    topics.set(topicName, new Set());
                }
                topics.get(topicName).add(conn);
                conn.subscribedTopics.add(topicName);
            });
        } else if (parsed && parsed.type === 'unsubscribe') {
            (parsed.topics || []).forEach(topicName => {
                const subs = topics.get(topicName);
                if (subs) {
                    subs.delete(conn);
                    if (subs.size === 0) {
                        topics.delete(topicName);
                    }
                }
                conn.subscribedTopics.delete(topicName);
            });
        } else if (parsed && parsed.type === 'publish') {
            if (parsed.topic) {
                const receivers = topics.get(parsed.topic);
                if (receivers) {
                    receivers.forEach(receiver => {
                        if (receiver !== conn) send(receiver, message);
                    });
                }
            }
        } else if (parsed && parsed.type === 'ping') {
            send(conn, JSON.stringify({ type: 'pong' }));
        }
    });
    
    conn.on('close', () => {
        conn.subscribedTopics.forEach(topicName => {
            const subs = topics.get(topicName);
            if (subs) {
                subs.delete(conn);
                if (subs.size === 0) {
                    topics.delete(topicName);
                }
            }
        });
    });
};

module.exports = { setupSignalingConnection };
