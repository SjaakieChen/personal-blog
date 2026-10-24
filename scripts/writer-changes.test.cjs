const {test}=require('node:test'),assert=require('node:assert/strict');
const {diff}=require('../assets/writer-changes.js');
test('comparison retains both originals, including punctuation, Unicode and whitespace',()=>{
  for(const [before,after] of [['',''],['old',''],['','new'],['The old words.','The new words!'],['one\ntwo','one\n\ntwo'],['你好 café 🌱','你好 café 🌿'],['repeat repeat end','repeat end'],['a '.repeat(600),'b '.repeat(600)]]) {
    const parts=diff(before,after);
    assert.equal(parts.filter(p=>p.type!=='added').map(p=>p.text).join(''),before);
    assert.equal(parts.filter(p=>p.type!=='removed').map(p=>p.text).join(''),after);
    if(before===after)assert.ok(parts.every(p=>p.type==='same'));
  }
});
test('separate edits preserve unchanged text between them',()=>{
  assert.deepEqual(diff('An old sentence with a full stop.','An edited sentence with a full stop!'),[
    {type:'same',text:'An '},{type:'removed',text:'old'},{type:'added',text:'edited'},
    {type:'same',text:' sentence with a full stop'},{type:'removed',text:'.'},{type:'added',text:'!'}
  ]);
});
