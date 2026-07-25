import { buildRuleBasedActionPlan } from './server/voice/planner.js';
const plan = buildRuleBasedActionPlan('go to products page', [{element:'a',text:'Products',selector:'#nav-products',contextText:'Navigation',position:{x:10,y:10,width:80,height:24}}]);
console.log(JSON.stringify(plan));
