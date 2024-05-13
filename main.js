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
let userStream = new MediaStream()
let displayStream = new MediaStream()
let myId
let remoteNewPeers = []
let remoteConnectedPeers = []
let docId
let USERDOC
let username

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
    USERDOC = userDoc
    const offerCandidates = collection(userDoc, 'offerCandidates');
    const answerCandidates = collection(userDoc, 'answerCandidates');

    let pc = await createPeerConnection(userDoc, offerCandidates)

    onSnapshot(userDoc, async (snapshot) => {
        const data = snapshot.data();
        // if there is an answer from a new user
        //!pc.currentRemoteDescription used so that when a new answer is added, the already established peer connections shouldn't take any action
        //only the new peer connection should take the action to establish the connection
        if (!pc.currentRemoteDescription && data?.answer) {
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
    await addUserSubDocument(callDoc, true)

    // Reference to the 'users' subcollection
    const users = collection(callDoc, 'users');

    // Function to handle the offer and answer process for each user
    async function handleOfferAndAnswerForUser(userDoc) {
        const pc = new RTCPeerConnection(servers)
        manageConnection(pc)
        handleMedia(pc)
        const offerCandidates = collection(userDoc, 'offerCandidates');
        const answerCandidates = collection(userDoc, 'answerCandidates');

        pc.onicecandidate = event => {
            if (event.candidate) {
                addDoc(answerCandidates, event.candidate.toJSON());
            }
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

async function createPeerConnection(userDoc, offerCandidates, ExistingPeer) {
    let pc
    if (ExistingPeer) {
        pc = ExistingPeer
    } else {
        pc = new RTCPeerConnection(servers)
        manageConnection(pc)
        handleMedia(pc)

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
        };
    }

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
// // Assume we have an RTCPeerConnection instance called peerConnection
//
// // Function to check the connection state
// function checkConnectionState(pc) {
//     pc.getStats(null).then(stats => {
//         let connected = false;
//
//         stats.forEach(report => {
//             // Check the candidate pair report for a successful connection
//             if (report.type === 'candidate-pair' && report.state === 'succeeded') {
//                 connected = true;
//             }
//         });
//
//         if (!connected) {
//             // Handle the disconnection
//             handleDisconnection();
//         }
//     });
// }
//
// // Function to handle the disconnection
// function handleDisconnection(pc, mediaElement) {
//     // Close the peer connection
//     pc.close();
//
//     // Remove media elements or perform other cleanup
//     mediaElement.remove()
//
// }
//
// Function to add a user sub-document
async function addUserSubDocument(callDoc, assignId = false) {
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
        myId = newUserCount;
        Array.from(document.getElementsByClassName("user")).forEach(function(element) {
            element.innerHTML = ` (User ${myId})`;
        });
        if (assignId) {
            return 
        }
        // Update the main document with the new user count
        transaction.update(callDoc, { userCount: newUserCount });

        // Create a new sub-document name using the updated count
        const userSubDocName = `user-${newUserCount}`;
        // Return reference to the new sub-document
        return doc(callDoc, 'users', userSubDocName);
    });
}

function getDOC() {
    if (!docId) {
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
        docId = docu.id;
        return docu
    }
    return doc(db, 'calls', docId)
}

// function handleMediaChannel (pc) {
//     const mediaTypeChannel = pc.createDataChannel("mediaType", {
//         negotiated: true,
//         id: 0
//     });
//     let syncCounter = 0
//     mediaTypeChannel.onopen = (event) => {
//         if (userStream.active) {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "userStream", id: userStream.id}));
//             mediaTypeChannel.send(JSON.stringify({syncCounter: syncCounter++, type: "userStream"}))
//             mediaTypeChannel.onmessage = event => {
//                 if (event.data === syncCounter - 1) {
//                     userStream.getTracks().forEach((track) => {
//                         pc.addTrack(track, userStream);
//                     });
//                 }
//             }
//         }
//         if (displayStream.active) {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "displayStream", id: displayStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//
//         userStream.onaddtrack = (event) => {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "userStream", id: userStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//         displayStream.onaddtrack = (event) => {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "displayStream", id: displayStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//     }
//
//     mediaTypeChannel.onmessage = (event) => {
//         const streamType = event.data;
//         // console.log("recieved stream", stream);
//         // // Check if the user entry exists in remotePeers
//         // if (remotePeers[stream.userId]) {
//         //     // If it exists, simply update the stream type with the new id
//         //     remotePeers[stream.userId][stream.type] = stream.id;
//         // } else {
//         //     // If it doesn't exist, create a new entry with the stream type and id
//         //     remotePeers[stream.userId] = { [stream.type]: stream.id };
//         // }
//         let remoteStream = new MediaStream()
//         let remoteDisplayStream = new MediaStream()
//         // Pull tracks from remote stream, add to video stream
//         pc.ontrack = (event) => {
//             // console.log(remotePeers)
//             // setTimeout(()=>{
//             //     console.log(remotePeers)
//             // }, 3000)
//             event.streams.forEach((stream) => {
//                 if (streamType === "user") {
//                     if (!remoteStream.active) {
//                         addVideo(remoteStream);
//                     }
//                     else {
//                         remoteStream.getTracks().forEach((track) => {
//                             track.stop()
//                             remoteStream.removeTrack(track);
//                         })
//                     }
//                     stream.getTracks().forEach((track) => {
//                         remoteStream.addTrack(track);
//                     });
//                 }
//                 else if (streamType === "display") {
//                     if (!remoteDisplayStream.active) {
//                         addVideo(remoteDisplayStream, false, true);
//                     }
//                     else {
//                         remoteDisplayStream.getTracks().forEach((track) => {
//                             track.stop()
//                             remoteDisplayStream.removeTrack(track);
//                         })
//                     }
//                     stream.getTracks().forEach((track) => {
//                         remoteDisplayStream.addTrack(track);
//                     });
//                 }
//             });
//         };
//     }
// }

function handleMedia(pc) {
    let remoteStream = new MediaStream()
    let remoteDisplayStream = new MediaStream()

    if (userStream.active) {
        userStream.getTracks().forEach((track) => {
            pc.addTrack(track, userStream);
        });
    }

    if (displayStream.active) {
        displayStream.getTracks().forEach((track) => {
            pc.addTrack(track, displayStream, new MediaStream());
        })
    }

    pc.ontrack = (event) => {
        if (event.streams[1]) { // check whether display stream was received
            if (!remoteDisplayStream.active) {
                remoteDisplayStream = event.streams[0]
                addVideo(remoteDisplayStream, false, true, pc)
            }
            else {
                remoteDisplayStream = event.streams[0]
            }
        }
        else { // else the user stream was received
            if (!remoteStream.active) {
                remoteStream = event.streams[0]
                addVideo(remoteStream, false, false, pc)
            }
            else {
                remoteStream = event.streams[0]
            }
        }
    }
}

function manageConnection(pc) {
    remoteNewPeers.push(pc)
    manageRenegotiation(pc)
    manageRemoteId(pc)
    manageRemoteName(pc)
    endConnection(pc)

    pc.onconnectionstatechange = ((event)=>{
        switch(pc.connectionState) {
            case "connected":
                remoteConnectedPeers.push(pc)
                remoteNewPeers = remoteNewPeers.filter(peerConnection => peerConnection !== pc)
                break
            case "closed":
                handleClosed(pc)
                break
        }
    })
}

function manageRenegotiation(pc) {
    const renegotiateChannel = pc.createDataChannel("renegotiate", {
        negotiated: true,
        id: 0
    });

    renegotiateChannel.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
            // Create an answer
            pc.createAnswer().then(async answer => {
                await pc.setLocalDescription(answer);
                // Send the answer back through the renegotiateChannel
                renegotiateChannel.send(JSON.stringify({'answer': answer}));
            });
        }
        else {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
    }

    pc.onnegotiationneeded = ((event) => {
        if (pc.connectionState === "connected") { // renegotiating after the initial connection is established
            renegotiate(pc, renegotiateChannel)
        }
    })
}

function renegotiate(pc, renegotiateChannel) {
    pc.createOffer().then(async offer => {
        await pc.setLocalDescription(offer);
        // Use the renegotiateChannel to send the offer to the remote peer
        renegotiateChannel.send(JSON.stringify({'offer': offer}));
    });
}

function manageRemoteId(pc) {
    const remoteIdChannel = pc.createDataChannel("remoteId", {
        negotiated: true,
        id: 1
    });

    remoteIdChannel.onopen = (()=>{
        remoteIdChannel.send(myId);
    })

    remoteIdChannel.onmessage = (event) => {
        pc.remoteId = event.data;
        if (!pc.remoteName) {
            pc.remoteName = `User ${event.data}`
        }
        if (pc.remoteDivHead) {
            pc["remoteDivHead"].innerText = pc.remoteName
        }
        if (pc.remoteScreenDivHead) {
            pc["remoteScreenDivHead"].innerText = `${pc.remoteName}'s Screen`
        }
    }
}

function manageRemoteName(pc) {
    const remoteNameChannel = pc.createDataChannel("remoteName", {
        negotiated: true,
        id: 2
    });

    remoteNameChannel.onopen = (()=>{
        if (username) {
            remoteNameChannel.send(username)
        }
        const nameButton = document.getElementById("nameButton")
        const nameInput = document.getElementById("name")
        nameInput.oninput = ((event) => {
            nameButton.innerText = "Apply"
        })
        nameButton.addEventListener("click", () => {
            const name = nameInput.value;
            if (name) {
                username = name; // Update the username
                remoteNameChannel.send(username); // Send the updated name
                nameButton.innerText = "Change";
            }
        });
    })

    remoteNameChannel.onmessage = (event) => {
        pc.remoteName = `${event.data} (User ${pc.remoteId})`;
        if (pc.remoteDivHead) {
            pc["remoteDivHead"].innerText = pc.remoteName
        }
        if (pc.remoteScreenDivHead) {
            pc["remoteScreenDivHead"].innerText = `${pc.remoteName}'s Screen`
        }
    }
}

function endConnection(pc) {
    const endChannel = pc.createDataChannel("end", {
        negotiated: true,
        id: 3
    });

    endChannel.onopen = (()=>{
        window.addEventListener('beforeunload', (event) => {
            deleteDoc(USERDOC)
            endChannel.send("end")
        });
    })

    endChannel.onmessage = (event) => {
        pc.close()
        handleClosed(pc)
    }
}

function handleClosed(pc) {
    remoteConnectedPeers = remoteConnectedPeers.filter(peerConnection => peerConnection !== pc)
    if (pc.remoteDiv) {
        pc.remoteDiv.remove()
    }
    if (pc.remoteScreenDiv) {
        pc.remoteScreenDiv.remove()
    }
}

// -------------------------     utilities      -----------------------------------

function addVideo(stream, user = false, screen = false, pc) {
    const div = document.createElement('div');
    div.classList.add("video-container-div")

    const heading = document.createElement('h3');
    if (screen && user) {
        heading.innerHTML = `Your Screen<span class="user">${myId ? ` (User ${myId})` : ''}</span>`;
    }
    else if (screen) {
        if (pc.remoteName) {
            heading.innerText = `${pc.remoteName}'s Screen`;
        }
        else {
            if (pc.remoteId) {
                heading.innerText = `User ${pc.remoteId}'s Screen`;
            }
            else {
                heading.innerText = "User Screen"
            }
        }
        pc.remoteScreenDivHead = heading
        pc.remoteScreenDiv = div
    }
    else {
        if (pc.remoteName) {
            heading.innerText = pc.remoteName;
        }
        else {
            if (pc.remoteId) {
                heading.innerText = `User ${pc.remoteId}`;
            }
            else {
                heading.innerText = "User"
            }
        }
        pc.remoteDivHead = heading
        pc.remoteDiv = div
    }

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
const screenShareButton = document.getElementById('screenShareButton');
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
        .then(async (stream) => {
            userStream = stream
            webcamVideo.srcObject = userStream
            for (const track of userStream.getTracks()) {
                for (const pc of remoteNewPeers) {
                    pc.addTrack(track, userStream);
                    const offerCandidates = collection(USERDOC, 'offerCandidates');
                    await createPeerConnection(USERDOC, offerCandidates, pc);
                }
                remoteConnectedPeers.forEach(pc => {
                    pc.addTrack(track, userStream);
                })
            }
            callButton.disabled = false;
            answerButton.disabled = false;
            webcamButton.disabled = true;
        })
}

screenShareButton.onclick = () => {
    navigator.mediaDevices.getDisplayMedia({
        video: {
            cursor: "always"
        },
        audio: false
    })
        .then(async (stream) => {
            displayStream = stream
            addVideo(displayStream, true, true)
            for (const track of displayStream.getTracks()) {
                for (const pc of remoteNewPeers) {
                    pc.addTrack(track, displayStream, new MediaStream());
                    const offerCandidates = collection(USERDOC, 'offerCandidates');
                    await createPeerConnection(USERDOC, offerCandidates, pc);
                }
                remoteConnectedPeers.forEach(pc => {
                    pc.addTrack(track, displayStream, new MediaStream());
                })
            }
            callButton.disabled = false;
            answerButton.disabled = false;
            screenShareButton.disabled = true;
        })
}

callButton.onclick = async () => {
    hangupButton.disabled = false
    getDOC()
    await hostMeet()
}

answerButton.onclick = async () => {
    hangupButton.disabled = false;
    docId = callInput.value;
    answerDiv.style.display = "none"
    callButton.style.display = "none"
    optionsDiv.style.justifyContent = "center"
    await joinMeet()
}

const nameButton = document.getElementById("nameButton")
const nameInput = document.getElementById("name")
nameInput.oninput = ((event) => {
    nameButton.innerText = "Apply"
})
nameButton.onclick = ((event) => {
    const name = nameInput.value
    if (name) {
        username = name
        nameButton.innerText = "Change"
    }
})

document.getElementById("hangupButton").onclick = ((event)=>{
    window.location.reload()
})
