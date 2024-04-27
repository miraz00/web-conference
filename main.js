// Import the functions you need from the SDKs you need
import {initializeApp} from "firebase/app";
import {collection, doc, getFirestore, runTransaction, setDoc, onSnapshot, addDoc, getDoc, getDocs, updateDoc, deleteDoc, deleteField} from "firebase/firestore";

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
let userStream

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};


let docID

async function hostMeet() {
    const callDoc = getDOC();
    const userDoc = await addUserSubDocument(callDoc)
    const offerCandidates = collection(userDoc, 'offerCandidates');
    const answerCandidates = collection(userDoc, 'answerCandidates');
    let pc = new RTCPeerConnection(servers)

    pc.onicecandidate = (event) => {
        event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
    };

    userStream.getTracks().forEach((track) => {
        pc.addTrack(track, userStream);
    });

    let offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };

    await setDoc(userDoc, {offer});

    onSnapshot(userDoc, async (snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            let remoteStream = new MediaStream()
            addRemoteVideo(remoteStream)
            // Pull tracks from remote stream, add to video stream
            pc.ontrack = (event) => {
                event.streams[0].getTracks().forEach((track) => {
                    remoteStream.addTrack(track);
                });
            };

            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);

            getDocs(answerCandidates).then(querySnapshot => {
                querySnapshot.forEach(docSnapshot => {
                    // Now you have access to each document snapshot
                    const candidateData = docSnapshot.data();
                    const candidate = new RTCIceCandidate(candidateData);
                    pc.addIceCandidate(candidate);
                });
            });

            await newOffer()

        }
    });

    // replace with new offer for new peer to connect
    async function newOffer() {
        await updateDoc(userDoc, {offer: deleteField()});
        const offerCandidatesSnapshot = await getDocs(offerCandidates);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            deleteDoc(offerCandidateDoc.ref);
        });

        pc = new RTCPeerConnection(servers);
        pc.onicecandidate = (event) => {
            event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
        };

        userStream.getTracks().forEach((track) => {
            pc.addTrack(track, userStream);
        });

        offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);

        const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
        };

        await setDoc(userDoc, {offer});
    }
}

async function joinMeet() {
// Reference to the 'calls' collection and the specific call document
    const callDocRef = getDOC()

// Reference to the 'users' subcollection
    const usersCollectionRef = collection(callDocRef, 'users');

// Function to handle the offer and answer process for each user
    async function handleOfferAndAnswerForUser(userDocRef) {
        const pc = new RTCPeerConnection(servers)


        pc.onicecandidate = event => {
            if (event.candidate) {
                addDoc(answerCandidatesCollectionRef, event.candidate.toJSON());
            }
        };

        userStream.getTracks().forEach((track) => {
            pc.addTrack(track, userStream);
        });
        let remoteStream = new MediaStream()
        addRemoteVideo(remoteStream)
        // Pull tracks from remote stream, add to video stream
        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach((track) => {
                remoteStream.addTrack(track);
            });
        };

        const userDocSnapshot = await getDoc(userDocRef);
        const offer = userDocSnapshot.data().offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const offerCandidatesCollectionRef = collection(userDocRef, 'offerCandidates');
        const offerCandidatesSnapshot = await getDocs(offerCandidatesCollectionRef);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            const candidate = new RTCIceCandidate(offerCandidateDoc.data());
            pc.addIceCandidate(candidate);
        });

        await updateDoc(userDocRef, { answer: deleteField() });
        const answerCandidatesCollectionRef = collection(userDocRef, 'answerCandidates');
        const answerCandidatesSnapshot = await getDocs(answerCandidatesCollectionRef);
        answerCandidatesSnapshot.forEach(answerCandidateDoc => {
            deleteDoc(answerCandidateDoc.ref);
        });

        const answerDescription = await pc.createAnswer();
        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };
        await pc.setLocalDescription(new RTCSessionDescription(answerDescription));

        await updateDoc(userDocRef, {answer});
    }

// Iterate over each user in the call
    getDocs(usersCollectionRef).then(usersSnapshot => {
        usersSnapshot.forEach(userDoc => {
            handleOfferAndAnswerForUser(userDoc.ref);
        });
    }).catch(error => {
        console.error("Error processing users in the call:", error);
    });

    await hostMeet()

}

// Function to add a user sub-document
async function addUserSubDocument(callDoc) {
    // Start a transaction to ensure atomic operations
    return await runTransaction(db, async (transaction) => {
        // Get the current state of the main document
        const callDocSnapshot = await transaction.get(callDoc);

        // If the main document does not exist, create it with a counter
        if (!callDocSnapshot.exists()) {
            transaction.set(callDoc, { userCount: 0 });
        }

        // Get the current user count
        const userCount = callDocSnapshot.data()?.userCount || 0;
        // Increment the user count
        const newUserCount = userCount + 1;
        // Update the main document with the new user count
        transaction.update(callDoc, { userCount: newUserCount });

        // Create a new sub-document name using the updated count
        const userSubDocName = `user-${newUserCount}`;
        // Return reference to the new sub-document
        return doc(callDoc, 'users', userSubDocName);
    });
}

function getDOC() {
    if (!docID) {
        const docu =  doc(collection(db, 'calls'));
        answerDiv.style.display = "none"
        callButton.style.display = "none"
        optionsDiv.style.justifyContent = "center"
        meetDiv.style.display = "block"
        meetId.insertAdjacentText("beforeend", docu.id)
        navigator.clipboard.writeText(docu.id)
            .then(() => {
                // Success message
                meetIdStatus.innerText = "Meet ID copied to clipboard";
            })
        docID = docu.id;
        return docu
    }
    return doc(db, 'calls', docID)
}


// -------------------------     utilities      -----------------------------------

function addRemoteVideo(stream) {
    const div = document.createElement('div');
    div.classList.add("video-container-div")

    const heading = document.createElement('h3');
    heading.innerText = "Friend"

    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.srcObject = stream

    div.appendChild(heading)
    div.appendChild(video);
    document.getElementById("video-container").appendChild(div);
}

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');
const answerDiv = document.getElementById("answer")
const optionsDiv = document.getElementById("meet-options")
const meetDiv = document.getElementById("meet")
const meetId = document.getElementById("meet-id")
const meetIdStatus = document.getElementById("meet-id-status")



webcamButton.onclick = () => {
    navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then((stream)=>{
            userStream = stream
            document.getElementById("webcamVideo").srcObject = stream
            callButton.disabled = false;
            answerButton.disabled = false;
            webcamButton.disabled = true;
        })
}

callButton.onclick = async () => {
    hangupButton.disabled = false
    getDOC()
    await hostMeet()
}

answerButton.onclick = async () => {
    hangupButton.disabled = false;
    docID = callInput.value;
    answerDiv.style.display = "none"
    callButton.style.display = "none"
    optionsDiv.style.justifyContent = "center"
    await joinMeet()
}

// Assume we have an RTCPeerConnection instance called peerConnection

// Function to check the connection state
function checkConnectionState(pc) {
    pc.getStats(null).then(stats => {
        let connected = false;

        stats.forEach(report => {
            // Check the candidate pair report for a successful connection
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                connected = true;
            }
        });

        if (!connected) {
            // Handle the disconnection
            handleDisconnection();
        }
    });
}

// Function to handle the disconnection
function handleDisconnection(pc) {
    // Close the peer connection
    pc.close();

    // Remove media elements or perform other cleanup

    // Optionally, try to re-establish the connection
}

// Set an interval to poll the connection state every 5 seconds
setInterval(checkConnectionState, 5000);


