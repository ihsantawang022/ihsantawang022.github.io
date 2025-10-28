
function openTab(tabName){
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`[data-tab='${tabName}']`).classList.add('active');
}
function toggleCard(card){
  const f=card.querySelector('.front'),b=card.querySelector('.back');
  if(f.style.display!=='none'){f.style.display='none';b.style.display='block';}
  else{f.style.display='block';b.style.display='none';}
}
function speak(t){
  if('speechSynthesis' in window){
    const u=new SpeechSynthesisUtterance(t);u.lang='en-US';
    speechSynthesis.cancel();speechSynthesis.speak(u);
  }
}
let dragged=null;
document.addEventListener('dragstart',e=>{if(e.target.classList.contains('draggable')) dragged=e.target;});
document.addEventListener('dragover',e=>{if(e.target.classList.contains('dropzone')) e.preventDefault();});
document.addEventListener('drop',e=>{if(e.target.classList.contains('dropzone')){e.preventDefault();e.target.appendChild(dragged);}});
function checkDrag(){
  const zones=document.querySelectorAll('.dropzone');let correct=0,total=0;
  zones.forEach(z=>{total++;let key=z.dataset.key;let el=z.querySelector('.draggable');
  if(el&&el.dataset.cat===key)correct++;});
  alert(`Benar: ${correct}/${total}`);
}
function gradeQuiz(){
  let score=0,total=0;
  document.querySelectorAll('.quiz-item').forEach(q=>{
    total++;const ans=q.dataset.answer.toLowerCase();
    const input=q.querySelector('input');if(input&&input.value.toLowerCase()===ans)score++;
  });
  alert(`Score: ${score}/${total}`);
}
