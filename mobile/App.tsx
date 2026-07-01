import AsyncStorage from "@react-native-async-storage/async-storage";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

const STORAGE_KEY = "tributary.serverUrl";

/**
 * Tributary mobile: a native shell around the studio web app.
 * The web room already does everything (WebRTC call, local MediaRecorder
 * recording, chunked upload, recovery) — this app provides an installable
 * entry point with camera/mic permissions, keep-awake while recording,
 * and a remembered server address. Join links pasted here open directly.
 */
export default function App() {
  useKeepAwake(); // recording/uploading must survive the screen timeout

  const [url, setUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const webviewRef = useRef<WebView>(null);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved) {
        setUrl(saved);
        setDraft(saved);
      }
      setLoaded(true);
    });
  }, []);

  const open = () => {
    let target = draft.trim();
    if (!target) return;
    if (!/^https?:\/\//.test(target)) target = `https://${target}`;
    setUrl(target);
    void AsyncStorage.setItem(STORAGE_KEY, target);
  };

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!url) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.center, { flex: 1, padding: 24 }]}
        >
          <Text style={styles.title}>Tributary</Text>
          <Text style={styles.subtitle}>Enter your studio address or paste a join link</Text>
          <TextInput
            style={styles.input}
            placeholder="studio.example.com or https://…/join/…"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={open}
          />
          <Pressable style={styles.button} onPress={open}>
            <Text style={styles.buttonText}>Open studio</Text>
          </Pressable>
          <Text style={styles.hint}>
            Recording happens on this device and uploads in the background — keep the app open
            until uploads finish.
          </Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <Pressable onPress={() => setUrl(null)} hitSlop={12} accessibilityLabel="Change server">
          <Text style={styles.topBarText}>⌂</Text>
        </Pressable>
        <Text style={styles.topBarUrl} numberOfLines={1}>
          {url.replace(/^https?:\/\//, "")}
        </Text>
        <Pressable onPress={() => webviewRef.current?.reload()} hitSlop={12}>
          <Text style={styles.topBarText}>↻</Text>
        </Pressable>
      </View>
      <WebView
        ref={webviewRef}
        source={{ uri: url }}
        style={styles.web}
        // WebRTC + MediaRecorder inside the page:
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState
        renderLoading={() => (
          <View
            style={[styles.center, StyleSheet.absoluteFill, { backgroundColor: "#0b0d12" }]}
          >
            <ActivityIndicator color="#4f7cff" />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0d12" },
  center: { alignItems: "center", justifyContent: "center" },
  title: { color: "#e8ecf4", fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { color: "#9ca3af", fontSize: 14, marginTop: 8, marginBottom: 24, textAlign: "center" },
  input: {
    alignSelf: "stretch",
    backgroundColor: "#1b2130",
    borderColor: "#2a3242",
    borderRadius: 10,
    borderWidth: 1,
    color: "#e8ecf4",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: "#4f7cff",
    borderRadius: 10,
    marginTop: 12,
    paddingVertical: 13,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  hint: { color: "#6b7280", fontSize: 12, marginTop: 20, textAlign: "center", lineHeight: 18 },
  topBar: {
    alignItems: "center",
    backgroundColor: "#141821",
    borderBottomColor: "#2a3242",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topBarText: { color: "#9ca3af", fontSize: 18 },
  topBarUrl: { color: "#6b7280", flex: 1, fontSize: 12, textAlign: "center" },
  web: { flex: 1, backgroundColor: "#0b0d12" },
});
