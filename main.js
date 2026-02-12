import { valid_words } from "./assets/valid_words.js";
import { official_answers } from "./assets/official_answers.js"

const answersSet = new Set(official_answers);

const checkWord = (word) => answersSet.has(word.toUpperCase());

//

function generateShortId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function createRoom() {
  const peer = new Peer(generateShortId(6), {
    debug: 2,
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true
  });

  peer.on('error', (err) => {
    if(err.type === 'unavailable-id'){
      peer.destroy();
      createRoom();
    } else {
      console.error(err);
    }
  });

  peer.on('open', (id) => {
    console.log("ID: " + id)
  });
}

createRoom();
