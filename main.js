// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, doc, collection, setDoc, addDoc, onSnapshot, getDoc, updateDoc} from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyAzkZ6h_b0t87mSQl1L6NmwjCP0GFjUjYU",
    authDomain: "webrtc-dfacc.firebaseapp.com",
    projectId: "webrtc-dfacc",
    storageBucket: "webrtc-dfacc.appspot.com",
    messagingSenderId: "855397544383",
    appId: "1:855397544383:web:3842bdf7a7534185bbb10a",
    measurementId: "G-ZZEBFDFQFP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

// Global State
let pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let exitChannel = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');
const answerDiv = document.getElementById("answer")
const optionsDiv = document.getElementById("options")
const meetDiv = document.getElementById("meet")
const meetId = document.getElementById("meet-id")
const meetIdStatus = document.getElementById("meet-id-status")

function closeVideo() {
    remoteVideo.srcObject = null
    webcamVideo.srcObject = null
    localStream.getTracks().forEach((track) => {
        track.stop();
    });
    answerDiv.style.display = "block"
    callButton.style.display = "inline-block"
    optionsDiv.style.justifyContent = "space-evenly"
    meetDiv.style.display = "none"
    callInput.value = ""
    meetId.innerText = "Meet ID: "
    meetIdStatus.innerText = ""
    webcamButton.disabled = false
    callButton.disabled = true;
    answerButton.disabled = true;
    pc = new RTCPeerConnection(servers);
    hangupButton.disabled = true
}
function webConference() {
// 1. Setup media sources

    webcamButton.onclick = async () => {
        localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        remoteStream = new MediaStream();

        // Push tracks from local stream to peer connection
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });

        // Pull tracks from remote stream, add to video stream
        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach((track) => {
                remoteStream.addTrack(track);
            });
        };

        webcamVideo.srcObject = localStream;
        remoteVideo.srcObject = remoteStream;

        callButton.disabled = false;
        answerButton.disabled = false;
        webcamButton.disabled = true;
    };

// 2. Create an offer
    callButton.onclick = async () => {
        hangupButton.disabled = false

        // Reference Firestore collections for signaling
        const callDoc = doc(collection(db, 'calls'));
        const offerCandidates = collection(callDoc, 'offerCandidates');
        const answerCandidates = collection(callDoc, 'answerCandidates');

        answerDiv.style.display = "none"
        callButton.style.display = "none"
        optionsDiv.style.justifyContent = "center"
        meetDiv.style.display = "block"
        meetId.insertAdjacentText("beforeend", callDoc.id)

        // Copy the text to the clipboard
        navigator.clipboard.writeText(callDoc.id)
            .then(() => {
                // Success message
                meetIdStatus.innerText = "Meet ID copied to clipboard";
            })
            .catch((error) => {
                // Error message
                meetIdStatus.innerText = `Failed to copy Meet ID: , ${error}`
            })

        // Get candidates for caller, save to db
        pc.onicecandidate = (event) => {
            event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
        };

        exitChannel = pc.createDataChannel("dataChannel", {negotiated: true, id: 0})
        // Create offer
        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);

        const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
        };

        await setDoc(callDoc, {offer});

        // Listen for remote answer
        onSnapshot(callDoc, (snapshot) => {
            const data = snapshot.data();
            if (!pc.currentRemoteDescription && data?.answer) {
                const answerDescription = new RTCSessionDescription(data.answer);
                pc.setRemoteDescription(answerDescription);
            }
        });

        // When answered, add candidate to peer connection
        onSnapshot(answerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    pc.addIceCandidate(candidate);
                }
            });
        });

        // non-host terminating
        exitChannel.onmessage = (ev) => {
            if (ev.data === "exit") {
                closeVideo()
            }
        }
        // host terminating
        hangupButton.onclick = (ev) => {
            if (pc.iceConnectionState === "connected") {
                exitChannel.send("exit")
                pc.close()
            }
            closeVideo()
        }
    };

// 3. Answer the call with the unique ID
    answerButton.onclick = async () => {

        hangupButton.disabled = false;

        const callId = callInput.value;
        const callDoc = doc(db, 'calls', callId);
        const answerCandidates = collection(callDoc, 'answerCandidates');
        const offerCandidates = collection(callDoc, 'offerCandidates');

        answerDiv.style.display = "none"
        callButton.style.display = "none"
        optionsDiv.style.justifyContent = "center"

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
        };

        const callData = (await getDoc(callDoc)).data();


        const offerDescription = callData.offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };


        await updateDoc(callDoc, {answer});

        onSnapshot(offerCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    let data = change.doc.data();
                    pc.addIceCandidate(new RTCIceCandidate(data));
                }
            });
        });

        exitChannel = pc.createDataChannel("dataChannel", {negotiated: true, id: 0})
        // host terminating
        exitChannel.onmessage = (ev) => {
            if (ev.data === "exit") {
                closeVideo()
            }
        }
        // non-host terminating
        hangupButton.onclick = (ev) => {
            if (pc.iceConnectionState === "connected") {
                exitChannel.send("exit")
                pc.close()
            }
            closeVideo()
        }
    };
}
webConference()

pc.onconnectionstatechange = (ev) => {
    if (pc.iceConnectionState === "disconnected") {
        pc.close()
        closeVideo()
    }
}