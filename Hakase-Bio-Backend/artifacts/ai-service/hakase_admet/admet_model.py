"""Hakase ADMET class to contain ADMET model and prediction function."""

from pathlib import Path

import numpy as np
import pandas as pd
import torch
from chemprop.data import (
    MoleculeDatapoint,
    MoleculeDataset,
)
from chemprop.models import load_model
from chemprop.data.dataloader import build_dataloader
from chemprop.models import MPNN
from chemprop.models.utils import load_output_columns
from lightning import pytorch as pl
from torch.utils.data import DataLoader

from rdkit import Chem
from scipy.stats import percentileofscore
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm

from hakase_admet.constants import (
    DEFAULT_DRUGBANK_PATH,
    DEFAULT_MODELS_DIR,
)
from hakase_admet.drugbank import (
    create_atc_code_mapping,
    filter_drugbank_by_atc,
    read_drugbank_data,
)
from hakase_admet.physchem import compute_physicochemical_properties
from hakase_admet.utils import get_drugbank_suffix


class ADMETModel:
    """Hakase ADMET model class."""

    def __init__(
        self,
        models_dir: Path | str = DEFAULT_MODELS_DIR,
        include_physchem: bool = True,
        drugbank_path: Path | None = DEFAULT_DRUGBANK_PATH,
        atc_code: str | None = None,
        num_workers: int | None = None,
    ) -> None:
        """Initialize the Hakase ADMET model.

        :param models_dir: Path to a directory containing subdirectories, each of which contains an ensemble
                           of Chemprop models.
        :param include_physchem: Whether to include physicochemical properties in the predictions.
        :param drugbank_path: Path to a CSV file containing DrugBank approved molecules
                              with ADMET predictions and ATC codes.
        :param atc_code: The ATC code to filter the DrugBank reference set by.
                         If None, the entire DrugBank reference set will be used.
        :param num_workers: Number of workers for the data loader. Zero workers (i.e., sequential data loading)
                            may be faster if not using a GPU, while multiple workers (e.g., 8) are faster with a GPU.
                            If None, defaults to 0 if no GPU is available and 8 if a GPU is available.
        """
        # Check parameters
        if atc_code is not None and drugbank_path is None:
            raise ValueError("DrugBank reference set must be provided to filter by ATC code.")

        # Set default num_workers
        if num_workers is None:
            num_workers = 8 if torch.cuda.is_available() else 0

        # Save parameters
        self.include_physchem = include_physchem
        self.num_workers = num_workers
        self._atc_code = atc_code

        # Load DrugBank reference set if needed
        self.drugbank, self.drugbank_atc_filtered = self._load_drugbank_data(
            drugbank_path=drugbank_path,
            atc_code=atc_code,
        )

        # Set device based on GPU availability
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Prepare lists to contain model details
        self.task_lists: list[list[str]] = []
        self.model_lists: list[list[MPNN]] = []
        self.scaler_lists: list[list[StandardScaler | None]] = []

        self._load_model_ensembles(models_dir)

    def _load_drugbank_data(
        self, drugbank_path: Path | None, atc_code: str | None
    ) -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
        """Load the drugbank data and map ATC codes to each drugbank index.

        :param drugbank_path: Path to the DrugBank data.
        :param atc_code: The ATC code to filter the DrugBank data by.
        :return: A tuple containing the DrugBank data and the filtered DrugBank data.
        """
        if drugbank_path is None:
            drugbank = drugbank_atc_filtered = None
            return drugbank, drugbank_atc_filtered

        drugbank = read_drugbank_data(drugbank_path=drugbank_path)

        drugbank_atc_filtered = filter_drugbank_by_atc(atc_code=atc_code, drugbank=drugbank)

        return drugbank, drugbank_atc_filtered

    def _load_model_ensembles(self, models_dir: Path | str) -> None:
        """Load model ensembles from the specified directory.

        :param models_dir: Path to the directory containing directories of model ensembles.
        """
        self.task_lists = []
        self.model_lists = []
        model_dirs = sorted(Path(models_dir).iterdir())

        for model_dir in model_dirs:
            model_paths = sorted(model_dir.glob("**/*.pt"))
            models = [load_model(model_path, multicomponent=False) for model_path in model_paths]
            task_names = load_output_columns(model_paths[0])

            self.task_lists.append(task_names)
            self.model_lists.append(models)

    @property
    def num_ensembles(self) -> int:
        """Get the number of ensembles."""
        return len(self.model_lists)

    @property
    def atc_code(self) -> str | None:
        """Get the ATC code."""
        return self._atc_code

    @atc_code.setter
    def atc_code(self, atc_code: str | None) -> None:
        """Set the ATC code and filter DrugBank based on provided ATC code.

        :param atc_code: The ATC code to filter the DrugBank reference set by.
                         If None, the entire DrugBank reference set will be used.
        """
        # Handle case of no DrugBank
        if self.drugbank is None:
            raise ValueError("Cannot set ATC code if DrugBank reference is not provided.")

        # Validate ATC code
        if atc_code is not None and atc_code not in create_atc_code_mapping(self.drugbank):
            raise ValueError(f"Invalid ATC code: {atc_code}")

        # Save ATC code
        self._atc_code = atc_code

        self.drugbank_atc_filtered = filter_drugbank_by_atc(atc_code=atc_code, drugbank=self.drugbank)

    def predict(self, smiles: str | list[str]) -> dict[str, float] | pd.DataFrame:
        """Make predictions on a list of SMILES strings.

        :param smiles: A SMILES string or a list of SMILES strings.
        :return: If smiles is a string, returns a dictionary mapping property name to prediction.
                 If smiles is a list, returns a DataFrame containing the predictions with SMILES strings as the index
                 and property names as the columns.
        """
        # Convert SMILES to list if needed
        smiles, smiles_type = self._prepare_smiles(smiles=smiles)

        mols, smiles = self._filter_valid_molecules(smiles=smiles)

        # Compute physicochemical properties
        if self.include_physchem:
            physchem_preds = compute_physicochemical_properties(all_smiles=smiles, mols=mols)
        else:
            physchem_preds = None

        # Set up data loader
        data_loader = self._build_dataloader(mols=mols)

        # Make predictions
        task_to_preds = self._make_ensemble_predictions(data_loader=data_loader)

        # Put preds in a DataFrame
        admet_preds = pd.DataFrame(task_to_preds, index=smiles)

        # Combine physicochemical and ADMET properties
        if physchem_preds is not None:
            assert physchem_preds.index.equals(admet_preds.index), "Internal Error: Indices do not match."
            preds = pd.concat((physchem_preds, admet_preds), axis=1)
        else:
            preds = admet_preds

        # Add DrugBank percentiles
        final_predictions = self._add_drugbank_percentiles(preds=preds, smiles=smiles)

        # Convert to dictionary if SMILES type is string
        if smiles_type == str:
            final_predictions = final_predictions.iloc[0].to_dict()

        return final_predictions

    def _prepare_smiles(self, smiles: list[str] | str) -> tuple[list[str], type]:
        """Ensure SMILES is a list and identify its type.

        :param smiles: A SMILES string or a list of SMILES strings.
        :return: A tuple containing a list of SMILES strings and the type of the SMILES string.
        """
        if isinstance(smiles, str):
            return [smiles], str
        return smiles, list

    def _filter_valid_molecules(self, smiles: list[str]) -> tuple[list[Chem.Mol], list[str]]:
        """Convert SMILES to RDKit molecules and filter out invalid ones.

        :param smiles: A list of SMILES strings.
        :return: A tuple containing a list of RDKit molecules and a list of SMILES strings.
        """
        valid_mols_smiles = [(Chem.MolFromSmiles(smile), smile) for smile in tqdm(smiles, desc="SMILES to Mol")]
        valid_mols_smiles = [(mol, smile) for mol, smile in valid_mols_smiles if mol]

        if len(valid_mols_smiles) < len(smiles):
            print(f"Warning: {len(smiles) - len(valid_mols_smiles):,} invalid molecules removed.")

        mols, filtered_smiles = zip(*valid_mols_smiles) if valid_mols_smiles else ([], [])

        return mols, filtered_smiles

    def _build_dataloader(self, mols: list[Chem.Mol]) -> DataLoader:
        """Create a DataLoader for model predictions.

        :param mols: A list of RDKit molecules.
        :return: A DataLoader.
        """
        data_points = [MoleculeDatapoint(mol=mol) for mol in mols]
        dataset = MoleculeDataset(data=data_points)
        return build_dataloader(dataset=dataset, num_workers=self.num_workers, shuffle=False)

    def _make_ensemble_predictions(self, data_loader: DataLoader) -> dict[str, np.ndarray]:
        """Run predictions across model ensembles.

        :param data_loader: A DataLoader.
        :return: A dictionary mapping task names to numpy arrays of predictions.
        """
        assert len(self.task_lists) == len(
            self.model_lists
        ), "Internal error: amount of retrieved models does not match the amount of tasks"

        task_to_preds = {}
        for tasks, models in tqdm(
            zip(self.task_lists, self.model_lists),
            total=self.num_ensembles,
            desc="model ensembles",
        ):
            with torch.inference_mode():
                trainer = pl.Trainer(
                    logger=False,
                    enable_checkpointing=False,
                    enable_progress_bar=True,
                    accelerator=self.device,
                    devices=1,
                )

                # Make predictions (concatenate across batches)
                preds = torch.stack(
                    [torch.cat(trainer.predict(model=model, dataloaders=data_loader), dim=0) for model in models]
                )

                # Average predictions over models
                preds = preds.mean(dim=0).numpy()

            for i, task in enumerate(tasks):
                task_to_preds[task] = preds[:, i]

        return task_to_preds

    def _add_drugbank_percentiles(self, preds: pd.DataFrame, smiles: list[str]) -> pd.DataFrame:
        """Compute and add DrugBank percentiles if DrugBank data is available.

        :param preds: A DataFrame of predictions.
        :param smiles: A list of SMILES strings.
        :return: A DataFrame of predictions with DrugBank percentiles added.
        """
        if self.drugbank is None:
            return preds

        drugbank_suffix = get_drugbank_suffix(atc_code=self.atc_code)

        drugbank_percentiles = {
            f"{property_name}_{drugbank_suffix}": [
                percentileofscore(self.drugbank_atc_filtered[property_name], value)
                for value in preds[property_name].values
            ]
            for property_name in preds.columns
        }
        drugbank_percentiles_df = pd.DataFrame(drugbank_percentiles, index=smiles)

        return pd.concat([preds, drugbank_percentiles_df], axis=1)
