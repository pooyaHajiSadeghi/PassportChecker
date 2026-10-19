"""Dependency-free tests for extraction decisions and pipeline integration."""
import ast
from datetime import date
from pathlib import Path
from typing import Optional
import re
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]

def pure_namespace(path):
    tree=ast.parse(path.read_text())
    names={'check_digit','parse_line2','parse_father_name','_digit_distance','parse_issue_date','parse_name_line','vote_name_tokens','clean_text','weighted_vote','vote_field','phase2_extract','_iso','parse_mrz_date','score_of'}
    tree.body=[n for n in tree.body if isinstance(n,ast.Assign) or isinstance(n,ast.FunctionDef) and n.name in names]
    # Only literal/configuration assignments exist at module level in these modules.
    env=dict(re=re,date=date,Optional=Optional,MIN_VALID_SCORE=50)
    def score(a): return a.get('valid_score') or 0
    def parse(value,birth,today):
        if not isinstance(value,str) or len(value)!=6 or not value.isdigit():return None
        year=2000+int(value[:2])
        try:
            result=date(year,int(value[2:4]),int(value[4:]))
            return date(year-100,result.month,result.day) if birth and result>today else result
        except ValueError:return None
    env.update(score_of=score,parse_mrz_date=parse)
    exec(compile(tree,str(path),'exec'),env)
    return env

EXTRACT=pure_namespace(ROOT/'app/core/holder_extraction.py')
class IntegrationTests(unittest.TestCase):
    def test_name_cleanup_and_strict_majority(self):
        self.assertEqual(EXTRACT['parse_name_line']('P<IRNTORABI<<BEHNAM<<<<KSKSK'),('TORABI','BEHNAM'))
        self.assertIsNone(EXTRACT['vote_name_tokens']([{'names':'ALI'},{'names':'REZA'}],'names'))
    def test_printed_fields_and_ambiguous_dates(self):
        texts=["Father's Name: HOSSEIN\n24/06/2023 22/09/1978 23/06/2028"]*3
        self.assertEqual(EXTRACT['parse_father_name'](texts),'HOSSEIN')
        args=(date(1978,9,22),date(2028,6,23),date(2026,10,19))
        self.assertEqual(EXTRACT['parse_issue_date'](texts,*args),date(2023,6,24))
        self.assertIsNone(EXTRACT['parse_issue_date'](['24/06/2023 25/06/2023']*3,*args))
    def test_pipeline_selected_page_and_output(self):
        tree=ast.parse((ROOT/'app/services/passport_service.py').read_text())
        tree.body=[n for n in tree.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
        from types import SimpleNamespace
        extraction=SimpleNamespace(**{k:v for k,v in EXTRACT.items() if not k.startswith('__')})
        extraction.collect_direct_attempts=Mock(return_value=[])
        extraction.phase2_extract=Mock(return_value=dict(first_name='BEHNAM',last_name='TORABI',father_name=None,issue_date=None,passport_number='ABC',nationality='IRN',sex='M',date_of_birth=date(1978,9,22),expiry_date=date(2028,6,23),notes=['name: fallback']))
        extraction.extract_printed_fields=Mock(return_value=dict(father_name='HOSSEIN',issue_date=date(2023,6,24)))
        backend=SimpleNamespace(collect_mrz_attempts=Mock(return_value=[{'valid_score':100}]),phase1_validate=Mock(return_value=(True,[],{'age':48,'best_valid_score':100})),score_of=lambda a:a['valid_score'],MIN_VALID_SCORE=50,ADULT_AGE=18)
        env=dict(Path=Path,backend=backend,extraction=extraction,configure_tesseract=lambda:None)
        exec(compile(tree,'service','exec'),env)
        events=[];result=env['PassportMRZChecker']().check(__file__,page_number=2,check_callback=events.append)
        self.assertEqual(extraction.collect_direct_attempts.call_args.kwargs['page_index'],1)
        self.assertEqual(extraction.extract_printed_fields.call_args.kwargs['page_index'],1)
        self.assertEqual(result['passport']['father_name'],'HOSSEIN')
        self.assertEqual(result['result']['Issue date'],'2023-06-24')
        self.assertTrue(result['result']['Warnings'])
        self.assertEqual(events[-1]['id'],'extraction')
        backend.phase1_validate.return_value=(False,['Rejected'],{})
        extraction.collect_direct_attempts.reset_mock()
        result=env['PassportMRZChecker']().check(__file__)
        self.assertEqual(result['result'],{'Passport':'Not Valid','Reasons':['Rejected']})
        extraction.collect_direct_attempts.assert_not_called()

if __name__=='__main__':unittest.main()
