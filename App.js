import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
} from "react-native";

// --- NATIVE FILE PICKER (Needed for Built Mobile Apps) ---
// NOTE: This library is required for built Android/iOS apps to access the file system.
// I cannot guarantee its functionality in this environment, but the structure is correct.
// In a real Expo project, you would run: expo install expo-document-picker
let DocumentPicker;
try {
  // Mocking the import for environments where we can't install it
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  DocumentPicker = null; 
}
// ---------------------------------------------------------

const { width } = Dimensions.get("window");

// Small icon placeholder (simple text)
const Icon = ({ name, size = 20, color = "#fff", style = {} }) => (
  <Text style={[{ fontSize: size, color }, style]}>{name?.substring(0, 1) || "•"}</Text>
);

/* ----------------- CSV parsing ----------------- */
const parseCSV = (csvText) => {
  if (!csvText || csvText.length === 0) return [];
  // FIX: The regular expression was unterminated (missing the closing '/').
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const rawHeaders = lines[0].split(",");
  const mapHeader = (header) => {
    const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h.includes("optiona") || h.includes("option1")) return "option1";
    if (h.includes("optionb") || h.includes("option2")) return "option2";
    if (h.includes("optionc") || h.includes("option3")) return "option3";
    if (h.includes("optiond") || h.includes("option4")) return "option4";
    if (h.includes("question")) return "q";
    if (h.includes("correctanswer") || h.includes("correct")) return "correct";
    if (h.includes("explanation")) return "explanation";
    return null;
  };

  const headerMap = rawHeaders.map(mapHeader);

  const parseLine = (line) => {
    // Regex to handle quoted CSV entries correctly
    const matches = line.match(/(?:\"([^\"]*(?:\"\"[^\"]*)*)\")|([^,]+)/g);
    if (!matches) return [];
    return matches.map((match) => {
      if (match.startsWith('"') && match.endsWith('"')) {
        return match.substring(1, match.length - 1).replace(/""/g, '"').trim();
      }
      return match.trim();
    });
  };

  const questions = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    if (values.length !== rawHeaders.length) {
      console.warn(`Skipping line ${i + 1} due to mismatch in columns.`);
      continue;
    }
    const question = {};
    let options = [];
    let hasQuestionText = false;
    for (let j = 0; j < values.length; j++) {
      const mappedKey = headerMap[j];
      const value = values[j];
      if (mappedKey === "q") {
        question.q = value;
        hasQuestionText = true;
      } else if (mappedKey && mappedKey.startsWith("option")) {
        options.push(value);
      } else if (mappedKey === "correct") {
        question.correct = value;
      } else if (mappedKey === "explanation") {
        question.explanation = value;
      }
    }
    if (hasQuestionText && options.length >= 2 && question.correct) {
      question.options = options;
      questions.push(question);
    }
  }
  return questions;
};

/* ----------------- Helper: shuffle ----------------- */
const shuffleArray = (array) => {
  const a = array.slice();
  let currentIndex = a.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [a[currentIndex], a[randomIndex]] = [a[randomIndex], a[currentIndex]];
  }
  return a;
};

/* ----------------- Main App ----------------- */
export default function App() {
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState([]);
  const [quizState, setQuizState] = useState("TOPIC_SELECT"); 
  const [csvContent, setCsvContent] = useState("");
  const [fileName, setFileName] = useState(null);
  const [newTopicName, setNewTopicName] = useState("");
  const [currentQuestions, setCurrentQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userResponses, setUserResponses] = useState({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null); 
  
  // Ref for the hidden HTML file input element (Web-only implementation)
  const fileInputRef = useRef(null); 


  // --- HANDLERS for File Selection ---

  // 1. Web-only handler (via hidden HTML input)
  const handleWebFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const name = file.name.toLowerCase();
    if (!name.match(/\.(csv|txt|xls|xlsx)$/)) {
        setMessage("Invalid file type. Please select CSV, TXT, XLS, or XLSX.");
        event.target.value = null; 
        return;
    }

    setFileName(file.name);
    setNewTopicName(file.name.replace(/\.[^/.]+$/, "")); 
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target.result;
      setCsvContent(content); 
      setMessage(`File loaded: ${file.name}. Enter/confirm topic name and save.`);
      setTimeout(()=>setMessage(""), 4000);
    };

    reader.onerror = () => {
      setMessage("Error reading file.");
    };

    reader.readAsText(file);
  };
  
  // 2. Native handler (via expo-document-picker)
  const handleNativeFileSelect = async () => {
    if (!DocumentPicker) {
        setMessage("File picking is only available after the app is built natively (APK/IPA). Please use Paste Content for now.");
        return;
    }
    setLoading(true);
    try {
        const result = await DocumentPicker.getDocumentAsync({
            type: ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            copyToCacheDirectory: true,
        });

        if (result.canceled === false && result.assets && result.assets[0].uri) {
            const asset = result.assets[0];
            
            // On native, we must read the file content from the URI
            if (Platform.OS === 'ios' || Platform.OS === 'android') {
                // This is where the magic happens on native: fetch content from a URI
                const content = await fetch(asset.uri).then(res => res.text());
                setCsvContent(content);
                setFileName(asset.name);
                setNewTopicName(asset.name.replace(/\.[^/.]+$/, "")); 
                setMessage(`File loaded: ${asset.name}. Ready to save.`);
                setTimeout(() => setMessage(""), 4000);
            }
        } else if (result.canceled === true) {
            setMessage("File selection cancelled.");
        }

    } catch (err) {
        console.error("Document Picker Error:", err);
        setMessage("Error picking file. Ensure permissions are granted.");
    } finally {
        setLoading(false);
    }
  };


  // 3. Trigger function (selects web or native)
  const handleFileSelectPress = () => {
      setCsvContent("");
      setFileName(null);
      
      if (Platform.OS === 'web') {
          // Web: trigger the hidden HTML input
          if (fileInputRef.current) {
              fileInputRef.current.value = ''; 
              fileInputRef.current.click();
          }
      } else {
          // Native (Expo Go / Built App): use the DocumentPicker
          handleNativeFileSelect();
      }
  };


  /**
   * Starts a practice session with the given list of questions.
   */
  const startPractice = useCallback((questionsList) => {
    if (!questionsList || questionsList.length === 0) {
      setMessage("No questions to practice.");
      return;
    }
    const withIds = questionsList.map((q, i) => ({ ...q, id: `${i}-${Date.now()}` }));
    setCurrentQuestions(withIds);
    setCurrentQuestionIndex(0);
    setUserResponses({});
    setQuizState("PRACTICE");
    setIsDrawerOpen(false);
  }, []);

  // Toggles topic selection for random practice
  const handleTopicToggle = (id) => {
    setSelectedTopicIds(prev =>
        prev.includes(id) ? prev.filter(tId => tId !== id) : [...prev, id]
    );
  };

  const handleImport = () => {
    if (!csvContent.trim()) { setMessage("Please select a file OR paste content."); return; }
    if (!newTopicName.trim()) { setMessage("Enter topic name."); return; }
    const parsed = parseCSV(csvContent);
    if (parsed.length === 0) { setMessage("No valid questions parsed from content."); return; }
    
    if (topics.some(t => t.topicName.toLowerCase() === newTopicName.trim().toLowerCase())) {
      setMessage("Topic with this name already exists.");
      return;
    }
    const newTopic = { id: `topic-${Date.now()}`, topicName: newTopicName.trim(), questions: parsed };
    setTopics(prev => [newTopic, ...prev]);
    setCsvContent("");
    setNewTopicName("");
    setFileName(null);
    setMessage(`Saved '${newTopic.topicName}' (${parsed.length} questions)`);
    setTimeout(()=>setMessage(""), 3000);
  };

  const handleDeleteTopic = (id, name) => {
    setOpenMenuId(null); // Close the menu
    Alert.alert("Delete topic", `Delete "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        setTopics(prev => prev.filter(t => t.id !== id));
        setSelectedTopicIds(prev => prev.filter(tId => tId !== id)); // Also remove from selection
      } }
    ]);
  };

  // FUNCTION: Starts random practice from selected topics
  const practiceRandomFromSelected = () => {
    if (selectedTopicIds.length === 0) {
        setMessage("Please select at least one topic for random practice.");
        setTimeout(()=>setMessage(""), 3000);
        return;
    }
    const selectedQuestions = topics
        .filter(t => selectedTopicIds.includes(t.id))
        .flatMap(t => t.questions);

    const shuffledQuestions = shuffleArray(selectedQuestions);
    startPractice(shuffledQuestions);
  };


  // Practice helpers
  const currentQuestion = useMemo(() => currentQuestions[currentQuestionIndex], [currentQuestions, currentQuestionIndex]);
  const currentResponse = useMemo(() => userResponses[currentQuestionIndex] || { selectedOption: null, isCorrect: false, isExplanationVisible: false }, [userResponses, currentQuestionIndex]);

  const checkAnswer = (selectedOption, question) => {
    if (!question) return false;
    if (selectedOption === question.correct) return true;
    const correctChar = question.correct?.trim?.().toUpperCase?.();
    const idx = ["A","B","C","D"].indexOf(correctChar);
    if (idx !== -1 && question.options && question.options[idx] === selectedOption) return true;
    return false;
  };

  const handleOptionSelect = (option) => {
    const isCorrect = checkAnswer(option, currentQuestion);
    setUserResponses(prev => ({
      ...prev,
      [currentQuestionIndex]: {
        selectedOption: option, 
        isCorrect,
        isExplanationVisible: prev[currentQuestionIndex]?.isExplanationVisible || false,
      }
    }));
  };

  const calculateScore = useCallback(() => {
    let finalScore = 0, attempted = 0;
    let corrects = 0;
    const incorrects = [];
    Object.entries(userResponses).forEach(([k, r]) => {
      if (r?.selectedOption) {
        attempted++;
        if (r.isCorrect) corrects++; else {
          const orig = currentQuestions[parseInt(k)];
          if (orig) incorrects.push(orig);
        }
      }
    });
    const total = currentQuestions.length;
    const unanswered = total - attempted;
    const accuracy = attempted > 0 ? Math.round((corrects / attempted) * 100) : 0;
    
    return { finalScore: corrects, attempted, total, incorrects, unanswered, accuracy };
  }, [userResponses, currentQuestions]);

  // UI screens
  if (loading) return <View style={styles.centered}><ActivityIndicator size="large" color="#1D4ED8" /><Text style={{color:"#1D4ED8"}}>Processing file...</Text></View>;

  if (quizState === "TOPIC_SELECT") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>📚 MCQ - Topics</Text>

        {/* 1. Hidden HTML input for file selection (WEB-ONLY) */}
        {Platform.OS === 'web' && (
          <View style={{position:'absolute', opacity:0, width:0, height:0, overflow:'hidden'}}>
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleWebFileChange} 
                accept=".csv,.txt,.xls,.xlsx" 
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import Topic Data</Text>
          <Text style={{fontSize:12, color:"#6B7280", marginBottom:10}}>
            *Note: File upload works in Web Preview or Built App (APK/IPA). For Expo Go, use the Paste box.
          </Text>

          <TextInput value={newTopicName} onChangeText={setNewTopicName} placeholder="Topic name (auto-filled from file or enter manually)" style={styles.input} />
          
          <View style={{ marginBottom: 10 }}>
            {/* 2. Button to trigger file selection (Conditional logic inside) */}
            <TouchableOpacity 
              onPress={handleFileSelectPress} 
              style={[styles.primaryBtn, { backgroundColor: "#3B82F6", marginTop: 0 }]}
            >
              <Text style={styles.primaryBtnText}>Select CSV / Excel File</Text>
            </TouchableOpacity>

            {/* 3. Text Area/Info Box for manual entry (Universal method) */}
            {fileName ? (
              <View style={[styles.input, { height: 60, justifyContent: 'center', backgroundColor: '#ECFDF5', borderColor: '#34D399' }]}>
                <Text style={{ fontWeight: 'bold', color: '#065F46' }}>File Ready: {fileName}</Text>
                <Text style={{ fontSize: 12, color: '#065F46' }}>Content is loaded and ready to save.</Text>
              </View>
            ) : (
              <TextInput 
                value={csvContent} 
                onChangeText={setCsvContent} 
                placeholder="OR paste CSV/Excel content here (First row = headers)" 
                style={[styles.input, { height: 140 }]} 
                multiline 
                textAlignVertical="top" 
              />
            )}
          </View>
          
          <TouchableOpacity 
            onPress={handleImport} 
            // Button is enabled if newTopicName is set (as requested)
            style={[styles.primaryBtn, {backgroundColor: (newTopicName.trim()) ? "#10B981" : "#D1D5DB"}]}
            disabled={!(newTopicName.trim())}
          >
            <Text style={styles.primaryBtnText}>Save Topic</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          {/* Text changed to 'Available Topics' as requested */}
          <Text style={styles.cardTitle}>Available Topics</Text>
          
          {topics.length === 0 ? <Text style={{color:"#64748B"}}>No topics yet. Import content above.</Text> : topics.map(t => {
            const isSelected = selectedTopicIds.includes(t.id);
            const checkboxBg = isSelected ? "#22C55E" : "#E5E7EB";
            const checkboxText = isSelected ? "✓" : "";
            const isMenuOpen = openMenuId === t.id;
            
            return (
              <View key={t.id} style={[styles.row, {justifyContent:'space-between'}]}>
                {/* Topic Info */}
                <View style={{flexDirection:'row', alignItems:'center', flex:1}}>
                  {/* Selection Checkbox */}
                  <TouchableOpacity onPress={() => handleTopicToggle(t.id)} style={{width:24, height:24, borderRadius:6, borderWidth:2, borderColor:'#9CA3AF', backgroundColor:checkboxBg, justifyContent:'center', alignItems:'center', marginRight:10}}>
                      <Text style={{color:'#fff', fontWeight:'bold'}}>{checkboxText}</Text>
                  </TouchableOpacity>

                  <View style={{flex:1}}>
                    <Text style={styles.topicName}>{t.topicName}</Text>
                    <Text style={{color:"#64748B"}}>{t.questions.length} questions</Text>
                  </View>
                </View>
                
                {/* Action Buttons: Practice and 3-Dot Menu */}
                <View style={{flexDirection:'row', alignItems:'center'}}>
                  <TouchableOpacity onPress={() => startPractice(t.questions)} style={styles.smallBtn}><Text style={{color:"#fff"}}>Practice</Text></TouchableOpacity>
                  
                  {/* 3-Dot Menu / Ellipsis Button */}
                  <View style={{ position: 'relative', marginLeft: 8 }}>
                      <TouchableOpacity 
                        onPress={() => setOpenMenuId(isMenuOpen ? null : t.id)} 
                        style={styles.menuButton}
                      >
                          <Text style={styles.menuIcon}>⋮</Text>
                      </TouchableOpacity>

                      {/* Dropdown Menu (only visible if openMenuId matches current topic ID) */}
                      {isMenuOpen && (
                          <View style={styles.dropdownMenu}>
                              <TouchableOpacity 
                                  onPress={() => handleDeleteTopic(t.id, t.topicName)} 
                                  style={styles.dropdownItem}
                              >
                                  <Text style={styles.dropdownText}>Delete</Text>
                              </TouchableOpacity>
                          </View>
                      )}
                  </View>
                </View>
              </View>
            )
          })}
          
          {topics.length > 0 && 
            // New "Random questions" button logic from selected topics
            <TouchableOpacity 
              onPress={practiceRandomFromSelected} 
              style={[
                styles.primaryBtn, 
                {marginTop:12, backgroundColor: selectedTopicIds.length > 0 ? "#F59E0B" : "#D1D5DB"}
              ]}
              disabled={selectedTopicIds.length === 0}
            >
                <Text style={styles.primaryBtnText}>Random questions</Text>
            </TouchableOpacity>}
        </View>
      </ScrollView>
    );
  }

  if (quizState === "PRACTICE") {
    // Destructure all score elements
    const { finalScore, attempted, total, incorrects, unanswered, accuracy } = calculateScore();
    const isAnswered = !!currentResponse.selectedOption;
    const questionNumber = currentQuestionIndex + 1;
    const totalQuestions = currentQuestions.length;
    const isLast = questionNumber === totalQuestions;

    return (
      // Changed background to white for the entire screen
      <View style={[styles.practiceScreen, {backgroundColor: '#fff'}]}> 
        
        {/* Top Navigation Bar with Padding */}
        <View style={styles.topNav}>
          {/* Back/Menu Button */}
          <TouchableOpacity onPress={() => setQuizState("TOPIC_SELECT")} style={[styles.navBtn, { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#E5E7EB', borderRadius: 8 }]}>
            <Text style={{ color: '#374151', fontWeight: 'bold' }}>← Menu</Text>
          </TouchableOpacity>

          {/* Question Counter */}
          <Text style={styles.title}>Question {questionNumber} / {totalQuestions}</Text>

          {/* List Toggle (renamed) - Toggles the drawer on press */}
          <TouchableOpacity onPress={() => setIsDrawerOpen(prev => !prev)} style={styles.smallBtnAlt}>
            <Text>{isDrawerOpen ? 'Close List' : 'List'}</Text>
          </TouchableOpacity>
        </View>

        {/* Scrollable Content Area: This section is now white and fills the space */}
        <ScrollView style={styles.questionScrollArea} contentContainerStyle={styles.scrollContentWrapper}>
          <View style={styles.questionContent}> 
            {/* Question text not bold */}
            <Text style={styles.question}>{currentQuestion?.q}</Text>
            <View style={{marginTop:12}}>
              {currentQuestion?.options?.map((opt, idx) => {
                const label = String.fromCharCode(65 + idx);
                const isSelected = currentResponse.selectedOption === opt;
                const isCorrectOption = checkAnswer(opt, currentQuestion);

                // Option visual feedback based on answer status
                let bg = "#F8FAFC", border="#E2E8F0", color="#0F172A";
                if (isAnswered) {
                    if (isSelected && isCorrectOption) { bg="#DCFCE7"; border="#34D399"; color="#065F46"; }
                    else if (isSelected && !currentResponse.isCorrect) { bg="#FFF1F2"; border="#FCA5A5"; color="#7F1D1D"; }
                    else if (!isSelected && isCorrectOption) { bg="#ECFDF5"; border="#86EFAC"; color="#065F46"; }
                }

                return (
                  <TouchableOpacity 
                    key={idx} 
                    onPress={() => handleOptionSelect(opt)} 
                    style={[styles.option, {backgroundColor:bg, borderColor:border}]}
                  >
                    <Text style={{fontWeight:"700", marginRight:8}}>{label}.</Text>
                    <Text style={{flex:1, color}}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Permanent explanation toggle UI - Always active */}
            <View style={{ marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => {
                  setUserResponses(prev => ({
                    ...prev,
                    [currentQuestionIndex]: {
                      ...prev[currentQuestionIndex],
                      isExplanationVisible: !currentResponse.isExplanationVisible
                    }
                  }));
                }}
                style={[styles.box, {
                    backgroundColor: '#fff', 
                    borderColor: '#E2E8F0', 
                    alignItems: 'center',
                }]}
              >
                {/* Updated to full English text */}
                <Text style={{ color: '#2563EB', fontWeight: '500' }}>
                  {currentResponse.isExplanationVisible ? "Hide Explanation" : "Show Explanation"}
                </Text>
              </TouchableOpacity>

              {/* Explanation Content (Only appears if visible flag is true) */}
              {currentResponse.isExplanationVisible && currentQuestion.explanation && (
                <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' }}>
                  <Text style={{ color: '#475569' }}>{currentQuestion.explanation}</Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
        
        {/* Fixed Navigation Footer - Raised and Seamless */}
        <View style={styles.fixedFooter}>
          <View style={{paddingHorizontal: 16}}>
            <View style={{flexDirection:"row", justifyContent:"space-between"}}>
              {/* PREVIOUS BUTTON: Hides explanation on navigation */}
              <TouchableOpacity 
                onPress={() => { 
                  if (currentQuestionIndex > 0) {
                      const newIndex = currentQuestionIndex - 1;
                      // Hide explanation for the new question index
                      setUserResponses(prev => ({
                        ...prev,
                        [newIndex]: {
                          ...(prev[newIndex] || {}),
                          isExplanationVisible: false,
                        }
                      }));
                      setCurrentQuestionIndex(newIndex);
                  } else { 
                      setQuizState("TOPIC_SELECT"); 
                  }
                }} 
                style={[styles.navBtn, {backgroundColor:"#6B7280"}]}
              >
                <Text style={{color:"#fff"}}>Previous</Text>
              </TouchableOpacity>
              
              {/* NEXT BUTTON: Hides explanation on navigation */}
              <TouchableOpacity 
                onPress={() => { 
                  if (isLast) { 
                      setQuizState("SUMMARY"); 
                  } else {
                      const newIndex = currentQuestionIndex + 1;
                      // Hide explanation for the new question index
                      setUserResponses(prev => ({
                        ...prev,
                        [newIndex]: {
                          ...(prev[newIndex] || {}),
                          isExplanationVisible: false,
                        }
                      }));
                      setCurrentQuestionIndex(newIndex);
                  } 
                }} 
                style={[styles.navBtn, {backgroundColor:"#2563EB"}]}
              >
                <Text style={{color:"#fff"}}>{isLast ? "Finish Session" : "Next"}</Text>
              </TouchableOpacity>
            </View>

            <Text style={{marginTop:10, color:"#475569", textAlign: 'center'}}>Score: {finalScore} / {attempted}</Text>
          </View>
        </View>


        {isDrawerOpen && (
          <View style={styles.drawer}>
            <ScrollView>
              <Text style={{fontWeight:"700", fontSize: 18, marginBottom: 10, color: '#1D4ED8'}}>MCQ List & Stats</Text>
              
              <View style={styles.statsCard}>
                <View style={styles.statsColumn}>
                    <Text style={styles.statLine}>Answered: <Text style={styles.statValue}>{attempted}</Text></Text>
                    <Text style={styles.statLine}>Unanswered: <Text style={styles.statValue}>{unanswered}</Text></Text>
                    <Text style={styles.statLine}>Total Questions: <Text style={styles.statValue}>{total}</Text></Text>
                </View>

                <View style={[styles.statsColumn, { borderLeftWidth: 1, borderColor: '#E5E7EB', paddingLeft: 10 }]}>
                    <Text style={styles.statLine}>Correct: <Text style={[styles.statValue, { color: '#059669' }]}>{finalScore}</Text></Text>
                    <Text style={styles.statLine}>Incorrect: <Text style={[styles.statValue, { color: '#DC2626' }]}>{incorrects.length}</Text></Text>
                    <Text style={styles.statLine}>Accuracy: <Text style={styles.statValue}>{accuracy}%</Text></Text>
                </View>
              </View>

              <Text style={{ fontWeight: "700", marginVertical: 8, marginTop: 15 }}>Jump To:</Text>
              <View style={{flexDirection:"row", flexWrap:"wrap"}}>
                {currentQuestions.map((q, i) => {
                  const resp = userResponses[i];
                  let bg="#E5E7EB", color="#374151";
                  if (resp?.selectedOption) { bg = resp.isCorrect ? "#059669" : "#DC2626"; color="#fff"; }
                  if (i === currentQuestionIndex) { bg="#2563EB"; color="#fff"; }
                  return <TouchableOpacity key={i} onPress={() => { setCurrentQuestionIndex(i); setIsDrawerOpen(false); }} style={{width:"18%", aspectRatio:1, margin:4, justifyContent:"center", alignItems:"center", backgroundColor:bg, borderRadius:8}}><Text style={{color, fontWeight:"700"}}>{i+1}</Text></TouchableOpacity>;
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </View>
    );
  }

  if (quizState === "SUMMARY") {
    const { finalScore, attempted, total, incorrects } = calculateScore();
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Session Complete!</Text>
        <View style={styles.card}>
          <Text style={{fontWeight:"700"}}>Total: {total}</Text>
          <Text style={{marginTop:6}}>Attempted: {attempted}</Text>
          <Text style={{marginTop:6}}>Correct: {finalScore}</Text>
          <Text style={{marginTop:6}}>Accuracy: {attempted>0 ? Math.round((finalScore/attempted)*100) : 0}%</Text>
          <View style={{flexDirection:"row", marginTop:12}}>
            <TouchableOpacity onPress={() => { setQuizState("TOPIC_SELECT"); }} style={[styles.primaryBtn, {flex:1, marginRight:8}]}><Text style={styles.primaryBtnText}>Back to Topics</Text></TouchableOpacity>
            {incorrects.length>0 && <TouchableOpacity onPress={() => startPractice(incorrects)} style={[styles.primaryBtn, {flex:1, backgroundColor:"#EF4444"}]}><Text style={styles.primaryBtnText}>Review {incorrects.length}</Text></TouchableOpacity>}
          </View>
        </View>
      </ScrollView>
    );
  }

  return null;
}

/* ----------------- Styles ----------------- */
const styles = StyleSheet.create({
  // Topic Select and Summary Screens
  container: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 60, backgroundColor: "#F3F4F6", minHeight: "100%" },
  
  // Practice Screen Layout (Modified for seamless white background)
  practiceScreen: { 
    flex: 1, 
    backgroundColor: "#F3F4F6", // This will be overridden to white in the component
  },
  topNav: {
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginBottom: 12, 
    paddingTop: 60, 
    paddingHorizontal: 16, 
  },
  questionScrollArea: { 
    flex: 1, 
    backgroundColor: "#fff", // Main content area is white
  },
  scrollContentWrapper: { 
    flexGrow: 1,
    paddingBottom: 130, // Increased padding to clear the RAISED fixed footer
  },
  questionContent: { 
    paddingHorizontal: 16, 
    paddingTop: 16, // <-- Spacing below the header tabs
    paddingBottom: 20,
  },
  fixedFooter: { 
    position: 'absolute', 
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16, 
    paddingBottom: 55, // Increased padding to LIFT the content (buttons/score) up
    backgroundColor: "#fff", 
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
    zIndex: 10,
  },
  // --- General Styles ---
  centered: { flex:1, justifyContent:"center", alignItems:"center" },
  title: { fontSize:22, fontWeight:"800", color:"#1D4ED8", marginBottom:12 },
  card: { backgroundColor:"#fff", padding:14, borderRadius:12, marginBottom:12, shadowColor:"#000", shadowOpacity:0.06, elevation:2 },
  cardTitle: { fontWeight:"700", marginBottom:8 },
  input: { borderWidth:1, borderColor:"#E5E7EB", padding:10, borderRadius:8, backgroundColor:"#fff", marginBottom:8, color: '#1F2937' },
  primaryBtn: { backgroundColor:"#10B981", padding:12, borderRadius:8, alignItems:"center", marginTop:8 },
  primaryBtnText: { color:"#fff", fontWeight:"700" },
  row: { flexDirection:"row", alignItems:"center", marginBottom:8 },
  topicName: { fontWeight:"700" },
  smallBtn: { backgroundColor:"#2563EB", padding:8, borderRadius:8 },
  smallBtnAlt: { padding:8, borderRadius:8, backgroundColor:"#EFF6FF", borderWidth:1, borderColor:"#BFDBFE" },
  question: { fontSize:18 }, 
  option: { flexDirection:"row", alignItems:"center", padding:12, borderRadius:10, borderWidth:1, marginBottom:8 },
  box: { padding:10, borderRadius:8, borderWidth:1 },
  navBtn: { paddingHorizontal:18, paddingVertical:10, borderRadius:8 },
  drawer: { 
    position:"absolute", 
    right:16, 
    top:100, 
    width: width * 0.75, 
    maxHeight: "85%", 
    backgroundColor:"#fff", 
    padding:12, 
    borderRadius:12, 
    elevation:8, 
    shadowColor:"#000",
    zIndex: 10,
  },
  
  statsCard: { 
    padding: 10, 
    backgroundColor: '#F9FAFB', 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#F3F4F6',
    flexDirection: 'row', 
    justifyContent: 'space-between',
    marginBottom: 8, 
  },
  statsColumn: {
    width: '49%', 
  },
  statLine: { fontSize: 14, color: '#4B5563', lineHeight: 22 },
  statValue: { fontWeight: '700', color: '#1F2937' },

  menuButton: { 
    padding: 8, 
    borderRadius: 8, 
    backgroundColor: '#F3F4F6', 
    width: 32, 
    height: 32, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  menuIcon: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#4B5563',
  },
  dropdownMenu: {
    position: 'absolute',
    right: 0,
    top: 40, 
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minWidth: 100,
    zIndex: 20, 
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  dropdownItem: {
    padding: 10,
  },
  dropdownText: {
    color: '#EF4444',
    fontWeight: '600',
  }
});