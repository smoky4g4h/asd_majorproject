import {addDays} from 'date-fns';
import type {Task} from './domain';

// Fictional starter tasks from the supplied board. Used only for a fresh demo.
const templates = [
 ['Research Competitor Dashboards','Analyze competitor products to uncover layout patterns, interaction strategies, and usability strengths.','High',5,0],
 ['Define Dashboard Information Architecture','Structure core modules, navigation flows, and hierarchy. Organize content for clarity, scalability, and a more intuitive user experience.','High',4,0],
 ['Prepare Low-Fidelity Wireframes','Create initial layout explorations focusing on structure and content placement.','Medium',6,0],
 ['Plan Usability Testing Session','Define testing objectives, prepare scenarios, and recruit participants for dashboard validation.','Medium',3,0],
 ['Prepare Usability Testing Prototype','Assemble interactive flows and key scenarios for moderated usability testing sessions.','High',4,0],
 ['Dashboard Accessibility Pass','Review contrast ratios, typography scaling, and keyboard navigation compliance.','High',7,7],
 ['Create Component System (Dashboard UI Kit)','Build reusable UI components including cards, tables, filters, and widgets.','Medium',8,5],
 ['Integrate Realistic Data States','Design empty, loading, and error state behaviors. Ensure interfaces remain clear and informative under different system conditions.','Low',5,2],
 ['Design Responsive Dashboard Views','Adapt layouts for tablet and mobile breakpoints. Maintain usability, hierarchy, and readability across varying screen sizes.','High',7,2],
 ['Refine Data Visualization Widgets','Improve readability, visual balance, and hierarchy. Enhance clarity of charts and analytic components to support faster decision-making.','Medium',7,4],
 ['Dashboard Layout v1','First layout iteration submitted for review, hierarchy evaluation and usability validation.','High',6,6],
 ['Dashboard UI Components (Core Set)','Define transitions, feedback, and hover behaviors. Enhance responsiveness and visual communication without distracting from usability.','Medium',8,8],
 ['Interaction & Micro-Animations','Validate hover states, transitions, and feedback animations across dashboard modules.','Low',4,4],
 ['Empty & Loading States','Validate skeleton screens, placeholders, and empty-state messaging across modules.','Medium',5,5],
 ['Dashboard Layout v1','First layout iteration submitted for review, hierarchy evaluation and usability validation.','High',6,6],
] as const;
const steps=['Review requirements','Prepare first draft','Check content and hierarchy','Review with the team','Check responsive layouts','Verify keyboard access','Resolve review feedback','Final handoff'];
export function referenceTasks(now:Date):Task[]{
 return templates.map(([title,description,priority,total,checked],i)=>({
  id:`t-${i}`,title,description,priority,status:i<5?'To-do':i<10?'On-going':'On Review',
  assignee:i%2?'u-faculty':'u-coordinator',meetingId:`m-${i%4}`,done:false,
  due:addDays(now,i>=10||i===5?0:[1,3,5,7,6][i%5]).toISOString(),
  collaboratorIds:i%3===0?['u-coordinator','u-faculty','u-hod']:['u-coordinator','u-faculty'],
  checklist:Array.from({length:total},(_,j)=>({id:`step-${j}`,text:steps[j],done:j<checked})),
 }));
}
