const { getArtistListeningStats, slugifyArtist } = require('../scoring/listeningHistory');
const curated = require('../../data/curated2026');
const { stripHtml } = require('../discovery/extractCandidate');
const { isValidReleaseDate } = require('../dates/isValidReleaseDate');
const openings = {
 direct: ['You already put this one on the good pile.', 'This one has your handwriting on it.', 'No algorithmic campaign necessary. You named it.'],
 returning: ['A familiar name gets another room in the house.', 'This artist has already earned some shelf space.', 'Another record from someone you keep returning to.'],
 interest: ['A name worth keeping within reach.', 'There is a thread here. Follow it.', 'A small signal, worth leaving the radio on for.'],
 explore: ['No verdict. An open door.', 'A new name has entered the building.', 'Unfamiliar territory. Leave room for it.']
};
function hash(s) { let n=2166136261; for(const c of s) n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0; }
function editorial(r, {stats=getArtistListeningStats(r.artist), picks=curated.picks, anticipated=curated.anticipated, toHear=curated.toHear, avoid=[]}={}) {
 const sameArtist=x=>slugifyArtist(x.artist)===slugifyArtist(r.artist);
 const direct=picks.some(x=>sameArtist(x)&&slugifyArtist(x.title)===slugifyArtist(r.albumTitle));
 const familiar=picks.some(sameArtist)||(stats?.totalListens||0)>=10;
 const interested=[...anticipated,...toHear].some(sameArtist);
 const band=direct?'direct':familiar?'returning':interested?'interest':'explore';
 const key=`${r.artist}|${r.albumTitle}|${r.lifecycle}`;
 const start=hash(key)%openings[band].length;
 const headline=Array.from({length:openings[band].length},(_,i)=>openings[band][(start+i)%openings[band].length]).find(x=>!avoid.includes(x))||openings[band][start];
 const facts=[];
 if(direct) facts.push('You explicitly named this album among your favorites and contenders.');
 else if(picks.some(sameArtist)) facts.push('You named another album by this artist among your favorites and contenders. This new release still has to earn its place.');
 else if((stats?.totalListens||0)>=10) facts.push(`Your Spotify export records ${stats.totalListens} plays by this artist. That is evidence of repeated attention, not a review of this album.`);
 else if(interested) facts.push('You marked this artist for future listening. That is curiosity, not a verdict.');
 else facts.push('There is not enough recorded evidence to predict your response. That leaves room to discover something.');
 if(r.releaseDate) facts.push(`${r.lifecycle==='released'?'Listed release date':'Scheduled release'}: ${r.releaseDate}${r.sourceFeed?` (${r.sourceFeed})`:''}.`);
 if(!r.releaseDate) facts.push('The release date is still unconfirmed.');
 return {attentionBand:band, attentionRank:({direct:3,returning:2,interest:1,explore:0})[band], headline, reasoning:facts.join(' '), scoringMethod:'rules-v1', evidenceLevel:'metadata', standoutTracks:[], score:null};
}
function extractWithoutAI(item) {
 const title=stripHtml(item.title||'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"');
 const text=stripHtml(item.content||item.description||'');
 const no={isAlbumAnnouncement:false,artist:null,albumTitle:null,releaseDate:null,evidenceText:null};
 if(/\b(reissue|deluxe|anniversary|live album|compilation|tour dates|festival lineup)\b/i.test(title)) return no;
 if(!/\b(announce[sd]?|announcing|details?|new album|new ep)\b/i.test(title)) return no;
 const match=title.match(/^(.+?)\s+(?:announce[sd]?|announcing|details?)\s+(?:(?:a|their|his|her|debut|new|next)\s+)*(?:album|ep)\s*[,\-:]?\s*["']([^"']+)["']/i);
 if(!match) return {...no,needsReview:/\b(album|ep)\b/i.test(title)};
 const artist=match[1].trim(),albumTitle=match[2].trim();
 const dates=text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}\b/gi)||[];
 // Only a date explicitly attached to the release, never the article's publication date.
 const releaseSentence=text.match(/(?:out|release[sd]?|arrives?|due)\s+(?:on\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2})/i);
 let releaseDate=null;
 if(releaseSentence&&dates.length){const parts=releaseSentence[1].match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})/);const months='january february march april may june july august september october november december'.split(' ');const iso=parts[3]+'-'+String(months.indexOf(parts[1].toLowerCase())+1).padStart(2,'0')+'-'+parts[2].padStart(2,'0');if(isValidReleaseDate(iso))releaseDate=iso;}
 return {isAlbumAnnouncement:true,artist,albumTitle,releaseDate,evidenceText:`Announcement: ${title}. Source: ${item.sourceFeed||'release feed'}.`};
}
module.exports={editorial,extractWithoutAI};
