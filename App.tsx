import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { randomUUID } from 'expo-crypto';
import { Runner } from './src/runner';
import { ProgressEvent, QuestStatus } from './src/models';

const TASK_NAME = 'daq-background-fetch';

TaskManager.defineTask(TASK_NAME, async () => {
  const token = await SecureStore.getItemAsync('discord_token');
  if (!token) return BackgroundFetch.Result.NoData;
  try {
    const runner = new Runner({ token, maxParallel: 2 });
    await runner.init();
    const pending = runner.pending();
    if (!pending.length) return BackgroundFetch.Result.NoData;
    await runner.run();
    return BackgroundFetch.Result.NewData;
  } catch {
    return BackgroundFetch.Result.Failed;
  }
});

type QuestItem = {
  id: string;
  name: string;
  status: QuestStatus;
  reward: string;
  remaining: number;
};

type SessionState = {
  id: string;
  token: string;
  status: 'idle' | 'running' | 'done' | 'error';
  orbs?: number | null;
};

export default function App() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [questsBySession, setQuestsBySession] = useState<Record<string, QuestItem[]>>({});
  const [logsBySession, setLogsBySession] = useState<Record<string, string[]>>({});
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const [orbs, setOrbs] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [tokenLocked, setTokenLocked] = useState(false);
  const [showWarning, setShowWarning] = useState(true);

  const logRef = useRef<Record<string, string[]>>({});
  const sessionsRef = useRef<SessionState[]>([]);
  const stopRef = useRef<boolean>(false);

  useEffect(() => {
    sessionsRef.current = sessions;
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    SecureStore.getItemAsync('discord_token').then((value) => {
      if (value) setToken(value);
    });
  }, []);

  // Auto create a blank session on first load
  useEffect(() => {
    if (sessionsRef.current.length === 0) {
      const id = randomUUID();
      const initial: SessionState = { id, token: '', status: 'idle', orbs: null };
      sessionsRef.current = [initial];
      setSessions([initial]);
      setActiveSessionId(id);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await BackgroundFetch.getStatusAsync();
        if (status === BackgroundFetch.Status.Restricted || status === BackgroundFetch.Status.Denied) {
          appendLog('Background fetch bị chặn bởi hệ thống.');
          return;
        }
        const tasks = await TaskManager.getRegisteredTasksAsync();
        const registered = tasks.some((t) => t.taskName === TASK_NAME);
        if (!registered) {
          await BackgroundFetch.registerTaskAsync(TASK_NAME, {
            minimumInterval: 15 * 60,
            stopOnTerminate: false,
            startOnBoot: true,
          });
          appendLog('Background fetch đã bật (15 phút/lần, tùy OS).');
        }
      } catch (err: any) {
        appendLog(`BG fetch error: ${err?.message || err}`);
      }
    })();
  }, []);

  const appendLog = (msg: string) => {
    const sid = activeSessionId || 'global';
    const existing = logRef.current[sid] || [];
    const next = [`${new Date().toLocaleTimeString()} ${msg}`, ...existing].slice(0, 200);
    logRef.current = { ...logRef.current, [sid]: next };
    setLogsBySession(logRef.current);
  };

  const addSession = () => {
    const id = randomUUID();
    setSessions((prev) => {
      const next = [...prev, { id, token: token.trim(), status: 'idle', orbs: null }];
      sessionsRef.current = next;
      if (!activeSessionId) setActiveSessionId(id);
      return next;
    });
    appendLog(`Added session ${token.trim() ? token.slice(0, 6) : 'blank'}`);
    // keep token so user can reuse
  };

  const runSession = async (s: SessionState) => {
    setRunningSessionId(s.id);
    stopRef.current = false;
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'running' } : x)));
    appendLog(`Start session ${s.id.slice(0, 6)}...`);

    const runner = new Runner({ token: s.token, maxParallel: 2 });
    const handler = (ev: ProgressEvent) => {
      if (ev.type === 'log') {
        logRef.current = {
          ...logRef.current,
          [s.id]: [`${new Date().toLocaleTimeString()} [${ev.level}] ${ev.message}`, ...(logRef.current[s.id] || [])].slice(0, 200),
        };
        setLogsBySession({ ...logRef.current });
      } else if (ev.type === 'progress') {
        setQuestsBySession((prev) => {
          const list = prev[s.id] || [];
          return {
            ...prev,
            [s.id]: list.map((q) => (q.id === ev.questId ? { ...q, remaining: ev.remaining } : q)),
          };
        });
      } else if (ev.type === 'status') {
        setQuestsBySession((prev) => {
          const list = prev[s.id] || [];
          return {
            ...prev,
            [s.id]: list.map((q) => (q.id === ev.questId ? { ...q, status: ev.status } : q)),
          };
        });
      } else if (ev.type === 'balance') {
        setOrbs(ev.orbs);
      }
    };
    runner.on('log', handler);
    runner.on('progress', handler);
    runner.on('status', handler);
    runner.on('balance', (ev) => {
      logRef.current = {
        ...logRef.current,
        [s.id]: [
          `${new Date().toLocaleTimeString()} Balance: ${ev.orbs}`,
          ...(logRef.current[s.id] || []),
        ].slice(0, 200),
      };
      setLogsBySession({ ...logRef.current });
      setSessions((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, orbs: ev.orbs } : x)),
      );
      setOrbs(ev.orbs);
    });

    try {
      await runner.init();
      const qs = runner.pending().map((q) => ({
        id: q.id,
        name: q.name,
        reward: q.reward.orbQuantity ? `${q.reward.orbQuantity} Orbs` : q.reward.name || 'Reward',
        status: 'pending' as QuestStatus,
        remaining: Math.max(0, q.target - (q.progress || 0)),
      }));
      setQuestsBySession((prev) => ({ ...prev, [s.id]: qs }));
      if (stopRef.current) throw new Error('Stopped');
      await runner.run();
      const bal = await runner['client'].getBalance().catch(() => null);
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'done', orbs: bal } : x)));
      setOrbs(bal ?? null);
      logRef.current = {
        ...logRef.current,
        [s.id]: [`${new Date().toLocaleTimeString()} Session ${s.id.slice(0, 6)} done.`, ...(logRef.current[s.id] || [])].slice(0, 200),
      };
      setLogsBySession({ ...logRef.current });
    } catch (err: any) {
      const stopped = err?.message === 'Stopped';
      logRef.current = {
        ...logRef.current,
        [s.id]: [`${new Date().toLocaleTimeString()} Session ${s.id.slice(0, 6)} ${stopped ? 'stopped' : 'error'}: ${err?.message || err}`, ...(logRef.current[s.id] || [])].slice(0, 200),
      };
      setLogsBySession({ ...logRef.current });
      setSessions((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, status: stopped ? 'idle' : 'error' } : x)),
      );
    } finally {
      runner.removeAllListeners();
      setRunningSessionId(null);
      setTokenLocked(false);
    }
  };

  const handleStartStop = async () => {
    // Auto-create session from input token if none exists
    if (sessions.length === 0 && token.trim()) {
      const id = randomUUID();
      const newSession: SessionState = { id, token: token.trim(), status: 'idle', orbs: null };
      const next = [newSession];
      sessionsRef.current = next;
      setSessions(next);
      setActiveSessionId(id);
      setToken('');
    }

    if (!activeSessionId) return;
    const current = (sessionsRef.current || sessions).find((s) => s.id === activeSessionId);
    if (!current) return;

    // always sync input token into current session if provided
    const nextToken = token.trim().length > 0 ? token.trim() : current.token;
    if (nextToken !== current.token) {
      current.token = nextToken;
      setSessions((prev) => prev.map((s) => (s.id === current.id ? { ...s, token: nextToken } : s)));
      sessionsRef.current = sessionsRef.current.map((s) => (s.id === current.id ? { ...s, token: nextToken } : s));
    }

    if (runningSessionId === activeSessionId) {
      stopRef.current = true;
      setSessions((prev) => prev.map((x) => (x.id === activeSessionId ? { ...x, status: 'idle' } : x)));
      setQuestsBySession((prev) => {
        const list = prev[activeSessionId] || [];
        return {
          ...prev,
          [activeSessionId]: list.map((q) => ({ ...q, status: 'pending' as QuestStatus })),
        };
      });
      setRunningSessionId(null);
      setTokenLocked(false);
      return;
    }

    if (current.status === 'running') return;
    setLoading(true);
    try {
      await SecureStore.setItemAsync('discord_token', current.token);
      setTokenLocked(true);
      await runSession(current);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể chạy quest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <Modal visible={showWarning} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.warnTitle}>Cảnh báo & Trách nhiệm</Text>
            <Text style={styles.warnText}>
              Dùng user token và auto quest có thể vi phạm ToS Discord. Bạn tự chịu trách nhiệm về mọi rủi ro
              (ban tài khoản, mất dữ liệu, v.v.). Không chia sẻ token.
            </Text>
            <Text
              style={styles.warnLink}
              onPress={() => Linking.openURL('https://github.com/Nguoibianhz/Discord-Auto-Quests')}
            >
              Official source: https://github.com/Nguoibianhz/Discord-Auto-Quests
            </Text>
            <Text
              style={styles.warnLink}
              onPress={() => Linking.openURL('https://github.com/ducknogit/discord-auto-quests-mobile')}
            >
              Android source: https://github.com/ducknogit/discord-auto-quests-mobile
            </Text>
            <Pressable style={styles.modalButton} onPress={() => setShowWarning(false)}>
              <Text style={styles.modalButtonText}>Tôi hiểu</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.title}>Discord Auto Quest Android</Text>
          <Text style={styles.subtitle}>Make by ducknovis · official source by hieudz</Text>
        </View>

        <Card>
          <Text style={styles.label}>Discord User Token</Text>
          <TextInput
            value={token}
            onChangeText={(v) => !tokenLocked && setToken(v)}
            placeholder="dMh8...your token"
            style={styles.input}
            autoCapitalize="none"
            secureTextEntry
            placeholderTextColor="#5f6b86"
          />
          <View style={styles.buttonRow}>
            <Pressable style={[styles.blackButton]} onPress={addSession} disabled={loading && !tokenLocked && !token}>
              <Text style={styles.blackButtonText}>Thêm session</Text>
            </Pressable>
            <Pressable
              style={[
                styles.blackButton,
                (sessions.length === 0 && !token) && styles.disabled,
                runningSessionId === activeSessionId && { backgroundColor: '#111111', borderColor: '#222' },
              ]}
              onPress={handleStartStop}
              disabled={sessions.length === 0 && !token}
            >
              <Text style={styles.blackButtonText}>
                {runningSessionId === activeSessionId ? 'Stop' : 'Start'}
              </Text>
            </Pressable>
          </View>
        </Card>

        <View style={styles.row}>
          <Card style={styles.flex1}>
            <Text style={styles.label}>Sessions</Text>
            {sessions.length === 0 && <Text style={styles.muted}>Chưa có session</Text>}
            {sessions.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.sessionRow, activeSessionId === s.id && styles.sessionActive]}
                onPress={() => {
                  setActiveSessionId(s.id);
                  setTokenLocked(false);
                  setToken(s.token);
                }}
              >
                <Text style={styles.questName}>ID {s.id.slice(0, 6)}</Text>
                <Text style={styles.questSub}>Status: {s.status}</Text>
                <Text style={styles.questSub}>Orbs: {s.orbs ?? '...'}</Text>
              </Pressable>
            ))}
          </Card>

          <Card style={styles.flex1}>
            <Text style={styles.label}>Orbs</Text>
            <Text style={styles.orbText}>{orbs ?? '...'}</Text>
          </Card>
        </View>

        <Card>
          <Text style={styles.label}>Quests</Text>
          <FlatList
            data={activeSessionId ? questsBySession[activeSessionId] || [] : []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.questRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.questName}>{item.name}</Text>
                  <Text style={styles.questSub}>{item.reward}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.questStatus}>{item.status}</Text>
                  <Text style={styles.questSub}>{item.remaining}s</Text>
                </View>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.muted}>Chưa có quest nào</Text>}
          />
        </Card>

        <Card style={styles.logsCard}>
          <Text style={styles.label}>Logs</Text>
          <ScrollView>
            {(activeSessionId ? logsBySession[activeSessionId] || [] : []).map((l, i) => (
              <Text key={i} style={styles.logLine}>
                {l}
              </Text>
            ))}
          </ScrollView>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={[styles.card, style]}>{children}</View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: Platform.select({ android: 32, ios: 16, default: 20 }),
  },
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 32,
    paddingTop: 48,
    gap: 14,
  },
  hero: {
    gap: 6,
    marginBottom: 2,
  },
  title: {
    color: '#e5e7eb',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#e0e7ff',
    fontSize: 13,
  },
  label: {
    color: '#e5e7eb',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: '#111111',
    borderColor: '#1f1f1f',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#e5e7eb',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 8,
  },
  questName: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  questSub: {
    color: '#9ba2b0',
    fontSize: 12,
  },
  questStatus: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  logLine: {
    color: '#e5e7eb',
    fontSize: 12,
    marginBottom: 4,
    lineHeight: 16,
  },
  muted: {
    color: '#ffffff',
    fontSize: 12,
  },
  flex1: { flex: 1 },
  orbText: { color: '#fbbf24', fontSize: 26, fontWeight: '700' },
  logsCard: { maxHeight: 260 },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  sessionRow: {
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  sessionActive: {
    backgroundColor: '#161b22',
    borderColor: '#22304a',
  },
  warnTitle: { color: '#fbbf24', fontWeight: '700', fontSize: 16 },
  warnText: { color: '#f59e0b', fontSize: 13, lineHeight: 18 },
  warnLink: { color: '#60a5fa', textDecorationLine: 'underline', fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    padding: 18,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    gap: 10,
  },
  modalButton: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: { color: '#e5e7eb', fontWeight: '700' },
  blackButton: {
    flex: 1,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  blackButtonText: { color: '#e5e7eb', fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
