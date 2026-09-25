"""One fixed experiment using body-relative hand shape and temporal motion.

Use validation for checkpoint selection, then score the same held-out cohort
as the baseline once. Its test set has been reported before, not a new blind test.
"""
from train import loss_and_grad, probabilities, metrics, normalize, save_checkpoint, load_checkpoint

import argparse
import json
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from motion_features import FEATURE_DIM, VERSION
from prepare import write_json
from prepare_motion import digest


def validate(data, audit, labels):
    if audit.get("feature_version") != VERSION or audit.get("input_features") != FEATURE_DIM:
        raise ValueError("Wrong feature version")
    if audit.get("feature_code_sha256") != digest(Path(__file__).with_name("motion_features.py")):
        raise ValueError("Feature extractor changed; rebuild the motion dataset")
    if audit.get("status") != "prepared" or any(audit[k] for k in ["clip_overlap", "signer_overlap", "identical_feature_overlap"]):
        raise ValueError("Dataset audit failed")
    if len(labels) != audit["classes"] or len(set(labels)) != len(labels):
        raise ValueError("Invalid labels")
    for name, checksum in {**audit["prepared_sha256"], **audit["metadata_sha256"], "labels.json": audit["labels_sha256"]}.items():
        path = (data/name).resolve()
        if not path.is_relative_to(data) or digest(path) != checksum:
            raise ValueError("Dataset file changed: " + name)
    groups = {}
    for split in ["train", "val", "test"]:
        rows = json.loads((data/f"{split}_clips.json").read_text())
        x = np.load(data/f"{split}_x.npy", mmap_mode="r", allow_pickle=False)
        y = np.load(data/f"{split}_y.npy", allow_pickle=False)
        if x.shape != (len(rows),FEATURE_DIM) or not np.isfinite(x).all():
            raise ValueError("Invalid feature array")
        if y.tolist() != [r["label_id"] for r in rows] or any(labels[r["label_id"]] != r["label"] for r in rows):
            raise ValueError("Misaligned clip labels")
        if set(y.tolist()) != set(range(len(labels))):
            raise ValueError("Missing classes")
        ids, signers = {r["clip_id"] for r in rows}, {r["signer"] for r in rows}
        if len(ids) != len(rows):
            raise ValueError("Duplicate clip IDs")
        groups[split] = ids, signers
    for a,b in [("train","val"),("train","test"),("val","test")]:
        if groups[a][0]&groups[b][0] or groups[a][1]&groups[b][1]:
            raise ValueError("Split leakage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    args = parser.parse_args()
    data, out = args.data.resolve(), args.run.resolve()
    if out.exists() and any(out.iterdir()):
        parser.error("Choose a new run directory")
    out.mkdir(parents=True,exist_ok=True)
    start = time.monotonic()
    write_json(out/"status.json", {"status":"validating", "pid":os.getpid()})
    try:
        audit = json.loads((data/"audit.json").read_text())
        labels = json.loads((data/"labels.json").read_text())
        validate(data,audit,labels)
        raw = np.load(data/"train_x.npy",allow_pickle=False)
        mean,scale = raw.mean(axis=0),np.maximum(raw.std(axis=0),.03)
        x = normalize(raw,mean,scale)
        del raw
        y = np.load(data/"train_y.npy",allow_pickle=False)
        vx = normalize(np.load(data/"val_x.npy",allow_pickle=False),mean,scale)
        vy = np.load(data/"val_y.npy",allow_pickle=False)
        config = {"model":"Bimanual temporal feature MLP", "feature_version":VERSION,
                  "input_features":FEATURE_DIM,"classes":len(labels),"hidden":128,"seed":42,
                  "epochs":100,"patience":15,"dropout":.35,"l2":.001,"learning_rate":.0005,
                  "batch_size":64,"optimizer":"Adam","gradient_norm_clip":5,"threads":2,
                  "normalization":"Training-only mean/std, floor 0.03, clip standardized inputs to [-6,6]",
                  "started_at":datetime.now(timezone.utc).isoformat(),"numpy":np.__version__,"python":platform.python_version(),
                  "data_audit_sha256":digest(data/"audit.json"),
                  "code_sha256":{n:digest(Path(__file__).with_name(n)) for n in ["train_motion.py","motion_features.py","prepare_motion.py","train.py"]},
                  "test_policy":"Same held-out cohort as first run, previously reported; no test-based selection in this experiment",
                  "use":"Local noncommercial research; no live application integration"}
        write_json(out/"config.json",config)
        rng=np.random.default_rng(42)
        params={"w1":(rng.normal(size=(FEATURE_DIM,128))*np.sqrt(2/FEATURE_DIM)).astype(np.float32),
                "b1":np.zeros(128,dtype=np.float32),
                "w2":(rng.normal(size=(128,len(labels)))*np.sqrt(1/128)).astype(np.float32),
                "b2":np.zeros(len(labels),dtype=np.float32)}
        m,v=({k:np.zeros_like(value) for k,value in params.items()} for _ in range(2))
        history=[]; best=-1.; best_loss=float('inf'); best_epoch=0; step=0
        print(f"Training motion-v2: {len(y)} clips, {len(labels)} classes, {FEATURE_DIM} features; CPU.",flush=True)
        for epoch in range(1,101):
            total_loss=0.
            order=rng.permutation(len(y))
            for offset in range(0,len(order),64):
                indices=order[offset:offset+64]
                loss,grads=loss_and_grad(params,x[indices],y[indices],l2=.001,dropout=.35,rng=rng)
                if not np.isfinite(loss) or any(not np.isfinite(g).all() for g in grads.values()):
                    raise ValueError("Nonfinite training state")
                total_loss+=loss*len(indices);step+=1
                norm=np.sqrt(sum(float(np.sum(g*g)) for g in grads.values()))
                for k in params:
                    g=grads[k]*min(1.,5./max(norm,1e-8))
                    m[k]*=.9;m[k]+=.1*g
                    v[k]*=.999;v[k]+=.001*g*g
                    params[k]-=.0005*(m[k]/(1-.9**step))/(np.sqrt(v[k]/(1-.999**step))+1e-8)
            val,_,_=metrics(probabilities(params,vx),vy,len(labels))
            if val['top1_accuracy']>best or (val['top1_accuracy']==best and val['cross_entropy']<best_loss):
                best,best_loss,best_epoch=val['top1_accuracy'],val['cross_entropy'],epoch
                save_checkpoint(out/'best.npz',params,mean,scale,labels,{**config,"epoch":epoch,"validation":val})
            row={"epoch":epoch,"training_loss":total_loss/len(y),"validation":val,"elapsed_seconds":round(time.monotonic()-start,2)}
            history.append(row)
            write_json(out/'history.json',history)
            write_json(out/'status.json',{"status":"training","epoch":epoch,"best_epoch":best_epoch,"best_validation_accuracy":best,"elapsed_seconds":row['elapsed_seconds']})
            print(f"Epoch {epoch:03d}: loss {row['training_loss']:.4f}, validation {val['top1_accuracy']:.2%}, best {best:.2%}",flush=True)
            if epoch-best_epoch>=15:
                break
        saved,sm,ss,sl,info=load_checkpoint(out/'best.npz')
        if sl!=labels or not np.array_equal(sm,mean) or not np.array_equal(ss,scale):
            raise ValueError("Checkpoint reload mismatch")
        test_x=normalize(np.load(data/'test_x.npy',allow_pickle=False),sm,ss)
        test_y=np.load(data/'test_y.npy',allow_pickle=False)
        test,confusion,per_class=metrics(probabilities(saved,test_x),test_y,len(labels))
        np.save(out/'test_confusion.npy',confusion,allow_pickle=False)
        write_json(out/'per-class.json',[{"label":label,**value} for label,value in zip(labels,per_class)])
        report={"status":"completed","feature_version":VERSION,"epochs_completed":len(history),"best_epoch":best_epoch,
                "best_validation":info['validation'],"test":test,"elapsed_seconds":round(time.monotonic()-start,2),
                "checkpoint_sha256":digest(out/'best.npz'),
                "splits":{s:{k:v for k,v in audit['splits'][s].items() if k!='per_class'} for s in ['train','val','test']},
                "test_policy":config['test_policy'],
                "limitations":["200 known isolated signs, no sentences or unknown-sign evaluation","Uses precomputed MediaPipe motion features; live-video preprocessing remains unvalidated","No facial grammar or meeting-video test","Scores are uncalibrated; no automatic speech or app deployment"]}
        write_json(out/'report.json',report)
        write_json(out/'status.json',{"status":"completed","test_accuracy":test['top1_accuracy'],"best_epoch":best_epoch})
        print(json.dumps(report,indent=2),flush=True)
    except BaseException as exc:
        write_json(out/'status.json',{"status":"interrupted" if isinstance(exc,KeyboardInterrupt) else "failed","reason":str(exc)})
        raise


if __name__ == '__main__':
    main()
