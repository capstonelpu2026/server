const fs = require('fs');
const filePath = 'c:/Users/chait/Downloads/FullStack/client/src/pages/RecruiterApplications.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// Find by unique button text
const buttonStart = content.indexOf('py-5 bg-green-600 text-white rounded-[24px] font-black shadow-2xl shadow-green-500/30 hover:bg-green-700 hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-widest uppercase">Authorize Hire</button>');

if (buttonStart === -1) {
    console.log('Button not found'); process.exit(1);
}

// Find the start of the offered block - go back to find the enclosing <> tag
const blockSearchStart = content.lastIndexOf('<>', buttonStart);
const fragmentEnd = content.indexOf('</>', buttonStart) + 3;

console.log('Fragment:',JSON.stringify(content.substring(blockSearchStart, fragmentEnd)));

const OLD_FRAGMENT = content.substring(blockSearchStart, fragmentEnd);
const NEW_FRAGMENT = `<>
                          {selectedApp.offerDetails?.status === 'accepted' ? (
                            <button
                              onClick={() => openConfirmDialog(selectedApp, 'hired')}
                              className="flex-1 min-w-[200px] py-5 bg-green-600 text-white rounded-[24px] font-black shadow-2xl shadow-green-500/30 hover:bg-green-700 hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-widest uppercase flex items-center justify-center gap-3"
                            >
                              <CheckCircle2 size={18} /> Authorize Hire
                            </button>
                          ) : selectedApp.offerDetails?.status === 'declined' ? (
                            <div className="flex-1 min-w-[200px] py-4 px-6 bg-red-500/10 border border-red-500/30 rounded-[24px] flex items-center gap-3">
                              <XCircle size={18} className="text-red-400 shrink-0" />
                              <div>
                                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Candidate Declined</p>
                                <p className="text-[9px] text-slate-500 font-bold mt-0.5">Revise & resend the offer to proceed</p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex-1 min-w-[200px] py-4 px-6 bg-amber-500/10 border border-amber-500/30 rounded-[24px] flex items-center gap-3 cursor-not-allowed">
                              <Clock size={18} className="text-amber-400 shrink-0 animate-pulse" />
                              <div>
                                <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Awaiting Candidate Acceptance</p>
                                <p className="text-[9px] text-slate-500 font-bold mt-0.5">Authorize Hire unlocks after candidate signs</p>
                              </div>
                            </div>
                          )}
                          <button onClick={() => openConfirmDialog(selectedApp, 'offered')} className="flex-1 min-w-[200px] py-5 bg-amber-600/10 text-amber-500 border border-amber-500/20 rounded-[24px] font-black hover:bg-amber-600/20 transition-all text-sm tracking-widest uppercase flex items-center justify-center gap-2">
                            <RotateCw size={16} /> Revise / Resend Offer
                          </button>
                        </>`;

content = content.substring(0, blockSearchStart) + NEW_FRAGMENT + content.substring(fragmentEnd);
fs.writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS. File length:', content.length);
