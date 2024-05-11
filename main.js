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

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let userStream

let docID

/**
 * creates a new document in firebase, creates "users" subcollection and a document is added as "user-1"(the host) in "users".
 * "offercandidates" and "answercandidates" subcollections are added in "user-1"
 * when the host generates it's icecandidates, they are added to "offercandidates"
 * the "offer" of the host is added to "user-1" document
 * the host waits for an "answer" from a peer by listening to the "user-1" document
 * after getting an answer, the icecandidates of the remote peer is added to the peer connection  from "answercandidates"
  */
async function hostMeet() {
    const callDoc = getDOC();
    const userDoc = await addUserSubDocument(callDoc)
    const offerCandidates = collection(userDoc, 'offerCandidates');
    const answerCandidates = collection(userDoc, 'answerCandidates');

    let pc = await createPeerConnection(userDoc, offerCandidates)

    onSnapshot(userDoc, async (snapshot) => {
        const data = snapshot.data();
        // if there is an answer from a new user
        //!pc.currentRemoteDescription used so that when a new answer is added, the already established peer connections shouldn't take any action
        //only the new peer connection should take the action to establish the connection
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

    /**
     * after the host connects with a peer, the host will delete his current offer and icecandidates to generate a new one for a new connection
     * the host also deletes the existing answer and the icecanidates of the established connection
     * then waits for answer and icecandidates from a new user(defined above on "onsnapshot" method)
     */
    async function newOffer() {
        await updateDoc(userDoc, {offer: deleteField()});
        const offerCandidatesSnapshot = await getDocs(offerCandidates);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            deleteDoc(offerCandidateDoc.ref);
        });

        await updateDoc(userDoc, {answer: deleteField()});
        const answerCandidatesSnapshot = await getDocs(answerCandidates);
        answerCandidatesSnapshot.forEach(answerCandidateDoc => {
            deleteDoc(answerCandidateDoc.ref);
        });

        pc = await createPeerConnection(userDoc, offerCandidates)
    }
}

/**
 * the guest joins the meet with the document id then refers to "users" collection where he will find the users that are on the meeting
 * with the names user-1(host), user-2 etc.....
 * with each user he will establish a peer connection
 * then he will call the hostMeet function to create a document for him "user-x" and proceeds in the way of how the host behaves
 * so that future arriving users can connect with him
 * the only difference being the call document already exist created by the original host
 */
async function joinMeet() {
    // Reference to the 'calls' collection and the specific call document
    const callDoc = getDOC()

    // Reference to the 'users' subcollection
    const users = collection(callDoc, 'users');

    // Function to handle the offer and answer process for each user
    async function handleOfferAndAnswerForUser(userDoc) {
        const pc = new RTCPeerConnection(servers)
        const offerCandidates = collection(userDoc, 'offerCandidates');
        const answerCandidates = collection(userDoc, 'answerCandidates');

        pc.onicecandidate = event => {
            if (event.candidate) {
                addDoc(answerCandidates, event.candidate.toJSON());
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

        const userDocSnapshot = await getDoc(userDoc);
        const offer = userDocSnapshot.data().offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        
        const offerCandidatesSnapshot = await getDocs(offerCandidates);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            const candidate = new RTCIceCandidate(offerCandidateDoc.data());
            pc.addIceCandidate(candidate);
        });

        const answerDescription = await pc.createAnswer();
        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };
        await pc.setLocalDescription(new RTCSessionDescription(answerDescription));

        await updateDoc(userDoc, {answer});
    }

    // Iterate over each user in the call
    getDocs(users).then(usersSnapshot => {
        usersSnapshot.forEach(userDoc => {
            handleOfferAndAnswerForUser(userDoc.ref);
        });
    }).catch(error => {
        console.error("Error processing users in the call:", error);
    });

    await hostMeet()

}

async function createPeerConnection(userDoc, offerCandidates) {
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
    // Set an interval to poll the connection state every 5 seconds
    // setInterval(checkConnectionState, 5000);
    return pc
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
function handleDisconnection(pc, mediaElement) {
    // Close the peer connection
    pc.close();

    // Remove media elements or perform other cleanup
    mediaElement.remove()

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


